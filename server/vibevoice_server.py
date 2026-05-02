"""
VibePod — VibeVoice FastAPI TTS Server

This server provides a high-performance Text-to-Speech (TTS) interface for the VibeVoice model,
optimized for real-time streaming on both CPU and NVIDIA GPU hardware.

MAINTAINER GUIDE / FILE MAP:
- Device & Env Configuration: Helpers for hardware detection and runtime tuning via env vars.
- Global State: Thread-safe storage for the loaded model, processor, and server status.
- Background Model Loader: Logic for downloading weights and initializing the model with optimizations.
- VibeVoice Patches: Performance-critical overrides for VibeVoice internals (hot-paths).
- FastAPI Application: SSE-based generation endpoint and health/status polling.
- Audio Streaming: Async bridge (NonBlockingAudioStreamer) between inference and the network.

RUNTIME CONFIGURATION (Environment Variables):
- VIBEPOD_DEVICE: 'cpu' or 'cuda' (auto-detected if unset).
- VIBEPOD_CHUNK_ACCUM: Number of 20ms audio chunks to buffer before sending an SSE event (default: 4 for CPU).
- VIBEPOD_PREBUFFER_SECS: Initial client-side buffer duration (hinted to frontend).
- VIBEPOD_REBUFFER_THRESHOLD_SECS: Buffer level below which the client pauses to refill.
- VIBEPOD_RESUME_THRESHOLD_SECS: Buffer level at which the client resumes playback.
- VIBEPOD_DEFAULT_INFERENCE_STEPS: Default DDPM steps (default: 8 for CPU, 10 for CUDA).
- VIBEPOD_PROFILE_GENERATION: Set to '1' to enable detailed performance logging.

CPU-SPECIFIC OPTIMIZATIONS:
- VIBEPOD_CPU_THREADS: Number of intra-op threads (defaults to logical core count / 2).
- VIBEPOD_CPU_INTEROP_THREADS: Number of inter-op threads (default: 1).
- VIBEPOD_CPU_MKLDNN: Set to '0' to disable MKLDNN (default: 1).
- VIBEPOD_CPU_BF16: Set to '1' to force bfloat16, '0' for float32.
- VIBEPOD_ASYNC_DECODE: Set to '1' to overlap decoding with inference on a separate thread (default: 1).
- VIBEPOD_QUANTIZE: Set to '1' to enable experimental dynamic INT8 quantization.
- VIBEPOD_COMPILE: Set to '1' to enable experimental torch.compile (limited benefit for TTS).

CUDA-SPECIFIC OPTIMIZATIONS:
- VIBEPOD_CUDA_DTYPE: 'bf16' (default) or 'fp16'.
- VIBEPOD_ATTN_IMPL: 'auto', 'sdpa', 'eager', or 'flash_attention_2'.
"""

import asyncio
import base64
import concurrent.futures
import copy
import functools
import importlib.util
import json
import logging
import os
import platform
import threading
import time
import types
import urllib.request
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from tqdm import tqdm as _BaseTqdm

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL_ID = "microsoft/VibeVoice-Realtime-0.5B"
SAMPLE_RATE = 24_000

VOICES_DIR = Path(__file__).parent / "voices" / "streaming_model"
VOICE_BASE_URL = "https://raw.githubusercontent.com/microsoft/VibeVoice/main/demo/voices/streaming_model"

EN_VOICES: dict[str, str] = {
    "carter": "en-Carter_man.pt",
    "davis": "en-Davis_man.pt",
    "emma": "en-Emma_woman.pt",
    "frank": "en-Frank_man.pt",
    "grace": "en-Grace_woman.pt",
    "mike": "en-Mike_man.pt",
}
DEFAULT_SPEAKER = "carter"

_IGNORE_PATTERNS = ["*.msgpack", "flax_model*", "tf_model*", "rust_model*", "*.ot"]

# ── Pipeline executor ──────────────────────────────────────────────────────────
# Overlaps acoustic_decode with forward_tts_lm on a background thread (1 worker).

_decode_executor: concurrent.futures.ThreadPoolExecutor | None = None

# ── Device selection ────────────────────────────────────────────────────────────
# VIBEPOD_DEVICE env var is set by start.sh based on the --cpu / --cuda flag.
# Falls back to auto-detection if not set.


def _resolve_device() -> str:
    """
    Resolve the target device (CPU or CUDA) by checking the VIBEPOD_DEVICE environment
    variable, falling back to CUDA if available, otherwise CPU.
    """
    env = os.environ.get("VIBEPOD_DEVICE", "").strip().lower()
    if env in ("cpu", "cuda"):
        if env == "cuda" and not torch.cuda.is_available():
            logger.warning(
                "VIBEPOD_DEVICE=cuda requested but CUDA is not available — falling back to CPU."
            )
            return "cpu"
        return env
    # Auto-detect
    return "cuda" if torch.cuda.is_available() else "cpu"


# ── Env-var helpers ─────────────────────────────────────────────────────────────


def _env_int(name: str, default: int) -> int:
    """Helper to read an integer environment variable with a fallback default."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid value for %s=%r — using default %d", name, raw, default)
        return default


def _env_float(name: str, default: float) -> float:
    """Helper to read a float environment variable with a fallback default."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid value for %s=%r — using default %g", name, raw, default)
        return default


def _cpu_supports_bf16() -> bool:
    """Return True if the CPU has AVX512_BF16 hardware support."""
    return (
        hasattr(torch, "cpu")
        and hasattr(torch.cpu, "is_avx512_bf16_supported")
        and torch.cpu.is_avx512_bf16_supported()
    )


def _configure_cpu_runtime() -> dict[str, object]:
    """
    Configure PyTorch's CPU execution engine, including thread counts and
    MKLDNN acceleration.
    """
    logical_cpus = os.cpu_count() or 1
    default_threads = (
        max(1, logical_cpus // 2) if platform.system() == "Windows" else logical_cpus
    )
    intra_threads = _env_int("VIBEPOD_CPU_THREADS", default_threads)
    interop_threads = _env_int("VIBEPOD_CPU_INTEROP_THREADS", 1)
    mkldnn_enabled = os.environ.get("VIBEPOD_CPU_MKLDNN", "1").strip() != "0"

    torch.set_num_threads(max(1, intra_threads))
    try:
        torch.set_num_interop_threads(max(1, interop_threads))
    except RuntimeError as exc:
        logger.warning("Could not set CPU inter-op threads: %s", exc)

    torch.backends.mkldnn.enabled = mkldnn_enabled
    return {
        "logical_cpus": logical_cpus,
        "threads": torch.get_num_threads(),
        "interop_threads": torch.get_num_interop_threads(),
        "mkldnn_available": torch.backends.mkldnn.is_available(),
        "mkldnn_enabled": torch.backends.mkldnn.enabled,
    }


# ── Global state ────────────────────────────────────────────────────────────────

ModelStatus = Literal["downloading", "loading", "online", "error"]

_processor = None
_model = None
_device: str = "cpu"
_model_status: ModelStatus = "loading"
_model_error: str | None = None
_voice_presets: dict[str, object] = {}
_load_lock = threading.Lock()
_generation_lock = asyncio.Lock()

# Config defaults (can be overridden by env vars)
# These are populated in _load_model_sync once the device is known.
_config = {
    "device": "cpu",
    "chunk_accum": 1,
    "prebuffer_secs": 2.0,
    "rebuffer_threshold_secs": 0.4,
    "resume_threshold_secs": 1.5,
    "default_inference_steps": 10,
}

# Download progress (files downloaded so far)
_dl_progress: dict[str, int] = {"done": 0, "total": 0}


# ── Progress-tracking tqdm (for model file downloads) ──────────────────────────


def _make_dl_tqdm() -> type:
    class _DlTqdm(_BaseTqdm):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, **kwargs)
            if isinstance(self.total, (int, float)) and 0 < self.total < 10_000:
                _dl_progress["total"] = int(self.total)
                _dl_progress["done"] = 0

        def update(self, n: int = 1) -> "bool | None":
            result = super().update(n)
            if isinstance(self.total, (int, float)) and 0 < self.total < 10_000:
                _dl_progress["done"] = int(self.n)
            return result

    return _DlTqdm


# ── Model / voice helpers ───────────────────────────────────────────────────────


def _is_model_cached() -> bool:
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            MODEL_ID, local_files_only=True, ignore_patterns=_IGNORE_PATTERNS
        )
        return True
    except Exception:
        return False


def _download_model() -> None:
    from huggingface_hub import snapshot_download

    token: str | None = os.environ.get("HF_TOKEN") or os.environ.get(
        "HUGGINGFACE_TOKEN"
    )
    DlTqdm = _make_dl_tqdm()
    logger.info("Model not cached — downloading %s...", MODEL_ID)
    snapshot_download(
        repo_id=MODEL_ID,
        ignore_patterns=_IGNORE_PATTERNS,
        token=token or None,
        tqdm_class=DlTqdm,
    )
    logger.info("Model download complete.")


def _download_voices() -> None:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    for _name, filename in EN_VOICES.items():
        dest = VOICES_DIR / filename
        if not dest.exists():
            url = f"{VOICE_BASE_URL}/{filename}"
            logger.info("Downloading voice preset: %s", filename)
            urllib.request.urlretrieve(url, dest)
    logger.info("Voice presets ready.")


# ── Background model loader ─────────────────────────────────────────────────────


def _init_processor():
    """
    Initialize the VibeVoiceStreamingProcessor from the model repository.
    """
    logger.info("Loading processor...")
    from vibevoice.processor.vibevoice_streaming_processor import (
        VibeVoiceStreamingProcessor,
    )

    return VibeVoiceStreamingProcessor.from_pretrained(MODEL_ID)


def _init_model(device: str):
    """
    Load the VibeVoice model with appropriate precision (BF16/FP16/FP32) and
    apply VibePod-specific performance optimizations.
    """
    logger.info("Loading model on %s...", device)
    if device == "cuda":
        torch.set_float32_matmul_precision("high")
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.enable_flash_sdp(True)
        torch.backends.cuda.enable_mem_efficient_sdp(True)
        torch.backends.cuda.enable_math_sdp(True)
        torch.backends.cuda.allow_fp16_bf16_reduction_math_sdp(True)
        logger.info(
            "PyTorch SDPA backends: flash=%s, mem_efficient=%s, math=%s",
            torch.backends.cuda.flash_sdp_enabled(),
            torch.backends.cuda.mem_efficient_sdp_enabled(),
            torch.backends.cuda.math_sdp_enabled(),
        )
    elif device == "cpu":
        torch.set_float32_matmul_precision("medium")
        logger.info("CPU runtime configuration: %s", _configure_cpu_runtime())

    cuda_dtype = os.environ.get("VIBEPOD_CUDA_DTYPE", "bf16").lower()
    if device == "cuda" and cuda_dtype == "fp16":
        load_dtype = torch.float16
    elif device == "cuda":
        load_dtype = torch.bfloat16
    else:
        cpu_bf16_env = os.environ.get("VIBEPOD_CPU_BF16", "auto").lower()
        if cpu_bf16_env == "1":
            load_dtype = torch.bfloat16
            logger.info("CPU BF16 forced via VIBEPOD_CPU_BF16=1")
        elif cpu_bf16_env == "0":
            load_dtype = torch.float32
            logger.info("CPU float32 forced via VIBEPOD_CPU_BF16=0")
        elif _cpu_supports_bf16():
            load_dtype = torch.bfloat16
            logger.info("AVX512_BF16 detected — loading model in bfloat16")
        else:
            load_dtype = torch.float32
            logger.info(
                "No AVX512_BF16 — using float32 (set VIBEPOD_CPU_BF16=1 to override)"
            )
    logger.info("Loading model weights with dtype %s", load_dtype)
    requested_attn_impl = os.environ.get("VIBEPOD_ATTN_IMPL", "auto").lower()
    has_flash_attn = importlib.util.find_spec("flash_attn") is not None
    if requested_attn_impl in {"eager", "sdpa"}:
        attn_impl = requested_attn_impl
    elif requested_attn_impl == "flash_attention_2":
        attn_impl = "flash_attention_2" if has_flash_attn else "sdpa"
    else:
        attn_impl = (
            "flash_attention_2" if device == "cuda" and has_flash_attn else "sdpa"
        )
    logger.info("Using Transformers attention implementation: %s", attn_impl)
    if device == "cuda" and not has_flash_attn:
        logger.info("flash_attn is not installed; using PyTorch SDPA attention.")

    from vibevoice.modular.modeling_vibevoice_streaming_inference import (
        VibeVoiceStreamingForConditionalGenerationInference,
    )

    try:
        model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
            MODEL_ID,
            torch_dtype=load_dtype,
            device_map=device,
            attn_implementation=attn_impl,
        )
    except Exception as exc:
        if attn_impl == "sdpa":
            raise
        logger.warning(
            "Model load with %s failed (%s); falling back to sdpa",
            attn_impl,
            exc,
        )
        model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
            MODEL_ID,
            torch_dtype=load_dtype,
            device_map=device,
            attn_implementation="sdpa",
        )

    model.eval()
    if device == "cpu":
        model = _apply_cpu_optimizations(model)
    model.set_ddpm_inference_steps(num_steps=_config["default_inference_steps"])
    _install_generation_optimizations(model)
    if device == "cpu":
        # Must run after _install_generation_optimizations so the async wrapper
        # sits outside the profiling wrapper (VibeVoice calls async → profiling → real decode).
        _install_cpu_pipeline_optimizations(model)
    return model


def _apply_cpu_optimizations(model: object) -> object:
    """
    Apply experimental CPU performance features like dynamic INT8 quantization
    or torch.compile if enabled via environment variables.
    """

    do_quantize = os.environ.get("VIBEPOD_QUANTIZE", "0") == "1"
    do_compile = os.environ.get("VIBEPOD_COMPILE", "0") == "1"

    if do_quantize:
        logger.info("Applying dynamic INT8 quantization to Linear layers...")
        try:
            import torch.ao.quantization

            # The diffusion prediction_head operates on small fixed-size tensors where
            # INT8 pack/unpack overhead exceeds the matmul savings (~+20% regression in
            # testing). Save and restore it so it stays in float32.
            saved_prediction_head = None
            if hasattr(model, "model") and hasattr(model.model, "prediction_head"):
                saved_prediction_head = model.model.prediction_head
                del model.model.prediction_head

            model = torch.ao.quantization.quantize_dynamic(
                model, {torch.nn.Linear}, dtype=torch.qint8
            )

            if saved_prediction_head is not None:
                model.model.prediction_head = saved_prediction_head
                logger.info(
                    "Dynamic INT8 quantization applied (prediction_head excluded — stays float32)."
                )
            else:
                logger.info("Dynamic INT8 quantization applied.")
        except Exception as exc:
            logger.warning("Dynamic quantization failed: %s — skipping", exc)

    if do_compile:
        # torch.compile with inductor on CPU is ineffective for autoregressive TTS:
        # each token step produces a unique input shape, so every step triggers a new
        # kernel compile event rather than reusing compiled code.  Kept as an escape
        # hatch but not recommended.
        compile_mode = os.environ.get("VIBEPOD_COMPILE_MODE", "reduce-overhead")
        logger.info(
            "torch.compile enabled (mode=%s) — NOTE: limited benefit for autoregressive"
            " models on CPU due to dynamic sequence lengths.",
            compile_mode,
        )
        _compile_targets: list[tuple[str, object, str, bool]] = [
            ("forward_tts_lm", model, "forward_tts_lm", True),
        ]
        if hasattr(model, "model"):
            inner = model.model
            if hasattr(inner, "prediction_head"):
                _compile_targets.append(
                    ("prediction_head", inner, "prediction_head", False)
                )
            if hasattr(inner, "acoustic_tokenizer") and hasattr(
                inner.acoustic_tokenizer, "decode"
            ):
                _compile_targets.append(
                    (
                        "acoustic_tokenizer.decode",
                        inner.acoustic_tokenizer,
                        "decode",
                        False,
                    )
                )

        for label, obj, attr, dynamic in _compile_targets:
            try:
                compiled = torch.compile(
                    getattr(obj, attr),
                    backend="inductor",
                    mode=compile_mode,
                    dynamic=dynamic,
                )
                setattr(obj, attr, compiled)
                logger.info("  compiled: %s", label)
            except Exception as exc:
                logger.warning(
                    "  torch.compile failed for %s: %s — skipping", label, exc
                )

    return model


def _install_generation_optimizations(model: object) -> None:
    """
    VibePod Optimization Patch:
    Replaces performance-critical VibeVoice methods with optimized versions.
    Includes caching for the noise scheduler and noise tensors to avoid
    re-allocation overhead during the diffusion loop.
    """

    def profile_enabled() -> bool:
        return os.environ.get("VIBEPOD_PROFILE_GENERATION", "0") == "1"

    def profile_sync() -> None:
        if torch.cuda.is_available():
            torch.cuda.synchronize()

    def profile_record(self, key: str, elapsed: float) -> None:
        stats = getattr(self, "_vibepod_profile", None)
        if stats is None:
            stats = {}
            self._vibepod_profile = stats
        bucket = stats.setdefault(key, {"count": 0, "seconds": 0.0})
        bucket["count"] += 1
        bucket["seconds"] += elapsed

    def timed_method(self, key: str, fn, *args, **kwargs):
        if not profile_enabled():
            return fn(*args, **kwargs)
        profile_sync()
        started = time.perf_counter()
        result = fn(*args, **kwargs)
        profile_sync()
        profile_record(self, key, time.perf_counter() - started)
        return result

    def prepare_noise_scheduler(self):
        scheduler = self.model.noise_scheduler
        cache_key = self.ddpm_inference_steps
        cache = getattr(self, "_vibepod_scheduler_cache", {})
        cached = cache.get(cache_key)

        if cached is None:
            scheduler.set_timesteps(self.ddpm_inference_steps)
            cached = {
                "num_inference_steps": scheduler.num_inference_steps,
                "timesteps": scheduler.timesteps,
                "sigmas": scheduler.sigmas,
            }
            cache[cache_key] = cached
            self._vibepod_scheduler_cache = cache
        else:
            scheduler.num_inference_steps = cached["num_inference_steps"]
            scheduler.timesteps = cached["timesteps"]
            scheduler.sigmas = cached["sigmas"]
            scheduler.model_outputs = [None] * scheduler.config.solver_order
            scheduler.lower_order_nums = 0
            scheduler._step_index = None
            scheduler._begin_index = None

        return scheduler

    def sample_speech_tokens_optimized(self, condition, neg_condition, cfg_scale=3.0):
        scheduler = prepare_noise_scheduler(self)

        condition = torch.cat([condition, neg_condition], dim=0).to(
            self.model.prediction_head.device
        )
        batch_size = condition.shape[0] // 2
        speech = torch.randn(batch_size, self.config.acoustic_vae_dim).to(condition)
        t_batch_cache_key = (
            self.ddpm_inference_steps,
            condition.device.type,
            condition.device.index,
            condition.dtype,
            batch_size,
        )
        t_batch_cache = getattr(self, "_vibepod_t_batch_cache", {})
        t_batches = t_batch_cache.get(t_batch_cache_key)
        if t_batches is None or len(t_batches) != len(scheduler.timesteps):
            t_batches = [
                t.repeat(condition.shape[0]).to(
                    device=condition.device, dtype=condition.dtype
                )
                for t in scheduler.timesteps
            ]
            t_batch_cache[t_batch_cache_key] = t_batches
            self._vibepod_t_batch_cache = t_batch_cache

        for t, t_batch in zip(scheduler.timesteps, t_batches):
            if batch_size == 1:
                combined = speech.expand(condition.shape[0], -1)
            else:
                combined = torch.cat([speech, speech], dim=0)
            if profile_enabled():
                profile_sync()
                started = time.perf_counter()
            eps = self.model.prediction_head(combined, t_batch, condition=condition)
            if profile_enabled():
                profile_sync()
                profile_record(
                    self, "diffusion_prediction_head", time.perf_counter() - started
                )
            cond_eps, uncond_eps = torch.split(eps, batch_size, dim=0)
            guided_eps = uncond_eps + cfg_scale * (cond_eps - uncond_eps)
            if profile_enabled():
                started = time.perf_counter()
            speech = scheduler.step(guided_eps, t, speech).prev_sample
            if profile_enabled():
                profile_record(
                    self, "diffusion_scheduler_step", time.perf_counter() - started
                )

        return speech

    forward_lm = model.forward_lm
    forward_tts_lm = model.forward_tts_lm
    acoustic_decode = model.model.acoustic_tokenizer.decode

    def forward_lm_profiled(*args, **kwargs):
        return timed_method(model, "forward_lm", forward_lm, *args, **kwargs)

    def forward_tts_lm_profiled(*args, **kwargs):
        return timed_method(model, "forward_tts_lm", forward_tts_lm, *args, **kwargs)

    def acoustic_decode_profiled(*args, **kwargs):
        return timed_method(model, "acoustic_decode", acoustic_decode, *args, **kwargs)

    model.forward_lm = forward_lm_profiled
    model.forward_tts_lm = forward_tts_lm_profiled
    model.model.acoustic_tokenizer.decode = acoustic_decode_profiled
    model.sample_speech_tokens = types.MethodType(sample_speech_tokens_optimized, model)
    logger.info("Installed VibeVoice generation hot-path optimizations.")


def _install_cpu_pipeline_optimizations(model: object) -> None:
    """
    VibePod Optimization Patch:
    Enables asynchronous audio decoding on a background thread.

    This allows the acoustic_decode (Vocoder) step to run in parallel with
    the next chunk's forward_tts_lm (Inference) step, significantly reducing
    the real-time factor on CPU.

    The JezzWTF/VibeVoice fork's generate() checks for two optional attributes:

      model._vibepod_decode_executor  — ThreadPoolExecutor (1 worker) that
          overlaps acoustic_decode with acoustic_connector + forward_tts_lm.
          Profiling showed this hides ~72s of decode cost behind tts_lm work,
          capturing ~96% of the theoretical overlap savings.

      model._vibepod_cfg_executor     — intentionally NOT set. Parallel pos/neg
          forward_tts_lm via a second thread causes MKL OpenMP thread-pool
          contention on CPU: both threads compete for the same OMP worker pool,
          making each call slower rather than faster. Net effect: ~6% regression.
          The hook remains in the fork for potential GPU or future use.

    Attributes default to None, so the fork's generate() falls back to the
    original sequential behaviour on CUDA or any non-VibePod install.
    """
    global _decode_executor

    if os.environ.get("VIBEPOD_ASYNC_DECODE", "1") != "1":
        logger.info("CPU async decode disabled via VIBEPOD_ASYNC_DECODE=0.")
        return

    _decode_executor = concurrent.futures.ThreadPoolExecutor(
        max_workers=1, thread_name_prefix="vibepod-decode"
    )
    model._vibepod_decode_executor = _decode_executor
    logger.info(
        "CPU pipeline: decode executor attached — acoustic_decode overlaps "
        "tts_lm. Disable with VIBEPOD_ASYNC_DECODE=0."
    )


def _model_float_dtype() -> torch.dtype:
    try:
        return next(_model.parameters()).dtype
    except StopIteration:
        return torch.float32


def _move_cached_prompt(value: object, device: str, dtype: torch.dtype) -> object:
    if torch.is_tensor(value):
        if torch.is_floating_point(value):
            return value.to(device=device, dtype=dtype)
        return value.to(device=device)
    if isinstance(value, dict):
        for k in list(value.keys()):
            value[k] = _move_cached_prompt(value[k], device, dtype)
        return value
    if isinstance(value, list):
        return [_move_cached_prompt(v, device, dtype) for v in value]
    if isinstance(value, tuple):
        return tuple(_move_cached_prompt(v, device, dtype) for v in value)
    if hasattr(value, "key_cache") and hasattr(value, "value_cache"):
        value.key_cache = [
            _move_cached_prompt(t, device, dtype) for t in value.key_cache
        ]
        value.value_cache = [
            _move_cached_prompt(t, device, dtype) for t in value.value_cache
        ]
    return value


def _load_voice_presets(device: str) -> dict[str, object]:
    """
    Load all pre-downloaded voice tensor files (.pt) from the voices directory.
    """
    presets = {}
    for name, filename in EN_VOICES.items():
        path = VOICES_DIR / filename
        if path.exists():
            presets[name] = torch.load(path, map_location=device, weights_only=False)
    return presets


def _load_model_sync() -> None:
    """
    Main synchronous initialization routine. Handles model/voice downloads,
    device configuration, and model loading. Updates global status for the
    health endpoint.
    """
    global _processor, _model, _device, _model_status, _model_error, _voice_presets, _config

    with _load_lock:
        if _model is not None:
            return

        try:
            if not _is_model_cached():
                _model_status = "downloading"
                _download_model()

            _model_status = "loading"
            _download_voices()

            # Resolve device from env var (set by start.sh --cpu/--cuda) or auto-detect.
            _device = _resolve_device()
            logger.info("Using device: %s", _device)

            # Populate config based on device
            is_cpu = _device == "cpu"
            _config["device"] = _device
            _config["chunk_accum"] = _env_int("VIBEPOD_CHUNK_ACCUM", 4 if is_cpu else 1)
            _config["prebuffer_secs"] = _env_float(
                "VIBEPOD_PREBUFFER_SECS", 24.0 if is_cpu else 5.0
            )
            _config["rebuffer_threshold_secs"] = _env_float(
                "VIBEPOD_REBUFFER_THRESHOLD_SECS", 2.0 if is_cpu else 1.0
            )
            _config["resume_threshold_secs"] = _env_float(
                "VIBEPOD_RESUME_THRESHOLD_SECS", 12.0 if is_cpu else 3.0
            )
            _config["default_inference_steps"] = _env_int(
                "VIBEPOD_DEFAULT_INFERENCE_STEPS", 8 if is_cpu else 10
            )
            if is_cpu:
                logical_cpus = os.cpu_count() or 1
                _config["cpu_threads"] = _env_int(
                    "VIBEPOD_CPU_THREADS",
                    (
                        max(1, logical_cpus // 2)
                        if platform.system() == "Windows"
                        else logical_cpus
                    ),
                )
                _config["cpu_interop_threads"] = _env_int(
                    "VIBEPOD_CPU_INTEROP_THREADS", 1
                )
                _config["cpu_mkldnn"] = (
                    os.environ.get("VIBEPOD_CPU_MKLDNN", "1").strip() != "0"
                )

            _processor = _init_processor()
            _model = _init_model(_device)
            _voice_presets = _load_voice_presets(_device)

            _model_status = "online"
            logger.info(
                "Model ready on %s. Voices: %s", _device, list(_voice_presets.keys())
            )
            logger.info("Configuration: %s", _config)

        except Exception as exc:
            _model_status = "error"
            _model_error = "Internal server error during model initialization."
            logger.exception("Failed to initialise model: %s", exc)


# ── FastAPI app ─────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    thread = threading.Thread(target=_load_model_sync, daemon=True, name="model-loader")
    thread.start()
    yield
    if _decode_executor is not None:
        _decode_executor.shutdown(wait=False)


app = FastAPI(title="VibePod TTS Server", version="0.1.0", lifespan=lifespan)


# ── Schemas ─────────────────────────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    speaker: str = Field(default=DEFAULT_SPEAKER)
    cfg_scale: float = Field(default=1.5, ge=0.5, le=4.0)
    inference_steps: int | None = Field(default=None, ge=5, le=20)

    @field_validator("text")
    @classmethod
    def text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v.strip()

    @field_validator("speaker")
    @classmethod
    def normalise_speaker(cls, v: str) -> str:
        return v.lower().strip()


# ── Endpoints ───────────────────────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    body: dict = {
        "status": _model_status,
        "model": MODEL_ID,
        "device": _device,
        "voices": list(_voice_presets.keys()),
        "config": _config,
    }
    if _model_status == "downloading":
        body["progress"] = {
            "done": _dl_progress["done"],
            "total": _dl_progress["total"],
        }
    if _model_error:
        body["message"] = _model_error
    return body


def _sync_generate(
    req: GenerateRequest,
    streamer: object | None = None,
    cancel_event: threading.Event | None = None,
) -> str:
    """
    Performs blocking model inference for TTS generation.

    This function should always be run in a thread-pool executor to avoid
    blocking the FastAPI event loop. It streams audio chunks back to the
    caller via the provided streamer object.
    """
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Generation cancelled.")

    speaker = req.speaker if req.speaker in _voice_presets else DEFAULT_SPEAKER
    model_dtype = _model_float_dtype()
    voice_preset = _move_cached_prompt(
        copy.deepcopy(_voice_presets[speaker]), _device, model_dtype
    )

    steps = (
        req.inference_steps
        if req.inference_steps is not None
        else _config["default_inference_steps"]
    )
    _model.set_ddpm_inference_steps(num_steps=steps)
    if os.environ.get("VIBEPOD_PROFILE_GENERATION", "0") == "1":
        _model._vibepod_profile = {}

    inputs = _processor.process_input_with_cached_prompt(
        text=req.text,
        cached_prompt=voice_preset,
        padding=True,
        return_tensors="pt",
        return_attention_mask=True,
    )
    for k, v in inputs.items():
        if torch.is_tensor(v):
            inputs[k] = v.to(_device)

    with torch.inference_mode():
        _model.generate(
            **inputs,
            max_new_tokens=None,
            cfg_scale=req.cfg_scale,
            tokenizer=_processor.tokenizer,
            generation_config={"do_sample": False},
            verbose=False,
            show_progress_bar=False,
            return_speech=False,
            stop_check_fn=cancel_event.is_set if cancel_event else None,
            all_prefilled_outputs=voice_preset,
            audio_streamer=streamer,
        )

    return speaker


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _generation_profile() -> dict[str, dict[str, float]] | None:
    if os.environ.get("VIBEPOD_PROFILE_GENERATION", "0") != "1":
        return None
    stats = getattr(_model, "_vibepod_profile", None)
    if not stats:
        return {}
    return {
        key: {
            "count": value["count"],
            "seconds": round(value["seconds"], 3),
            "avg_ms": (
                round(value["seconds"] * 1000 / value["count"], 3)
                if value["count"]
                else 0.0
            ),
        }
        for key, value in sorted(stats.items())
    }


@app.post("/generate")
async def generate(req: GenerateRequest, request: Request) -> StreamingResponse:
    if _model_status != "online":
        detail = {
            "downloading": "Model is downloading — please wait.",
            "loading": "Model is loading into memory — please wait.",
            "error": f"Model failed to load: {_model_error or 'unknown error'}",
        }.get(_model_status, "Server not ready.")
        raise HTTPException(status_code=503, detail=detail)

    if _generation_lock.locked():
        raise HTTPException(
            status_code=503, detail="Server is already generating audio. Please wait."
        )

    async def event_stream() -> AsyncGenerator[str, None]:
        class NonBlockingAudioStreamer:
            """Async streamer that keeps GPU->CPU copies out of the model thread."""

            def __init__(self, batch_size: int, stop_signal: object = None) -> None:
                self.batch_size = batch_size
                self.stop_signal = stop_signal
                self.audio_queues = [asyncio.Queue() for _ in range(batch_size)]
                self.finished_flags = [False for _ in range(batch_size)]
                self.loop = asyncio.get_running_loop()

            def put(
                self, audio_chunks: torch.Tensor, sample_indices: torch.Tensor
            ) -> None:
                for i, sample_idx in enumerate(sample_indices):
                    idx = sample_idx.item()
                    if idx < self.batch_size and not self.finished_flags[idx]:
                        self.loop.call_soon_threadsafe(
                            self.audio_queues[idx].put_nowait,
                            audio_chunks[i].detach(),
                        )

            def end(self, sample_indices: torch.Tensor | None = None) -> None:
                if sample_indices is None:
                    indices_to_end = range(self.batch_size)
                else:
                    indices_to_end = [
                        s.item() if torch.is_tensor(s) else s for s in sample_indices
                    ]
                for idx in indices_to_end:
                    if idx < self.batch_size and not self.finished_flags[idx]:
                        self.loop.call_soon_threadsafe(
                            self.audio_queues[idx].put_nowait, self.stop_signal
                        )
                        self.finished_flags[idx] = True

        start = time.monotonic()
        streamer = NonBlockingAudioStreamer(batch_size=1)
        cancel_event = threading.Event()

        accum_size = max(1, _config["chunk_accum"])
        accumulated_chunks = []
        chunk_count = 0
        audio_samples = 0
        first_chunk_at: float | None = None
        last_chunk_at: float | None = None
        max_chunk_gap = 0.0
        speaker = req.speaker if req.speaker in _voice_presets else DEFAULT_SPEAKER

        async with _generation_lock:
            loop = asyncio.get_event_loop()
            future = loop.run_in_executor(
                None, functools.partial(_sync_generate, req, streamer, cancel_event)
            )
            future.add_done_callback(lambda _: streamer.end())

            # Drain audio chunks as they arrive from the diffusion head.
            # stop_signal=None is the default sentinel that ends the queue.
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        streamer.audio_queues[0].get(), timeout=120.0
                    )
                except asyncio.TimeoutError:
                    cancel_event.set()
                    future.cancel()
                    yield _sse({"type": "error", "message": "Generation timed out"})
                    return

                if await request.is_disconnected():
                    cancel_event.set()
                    future.cancel()
                    logger.info("Generation client disconnected; stream cancelled.")
                    return

                if chunk is None:  # stop signal
                    break

                accumulated_chunks.append(chunk.detach())

                if len(accumulated_chunks) >= accum_size:
                    now = time.monotonic()
                    if first_chunk_at is None:
                        first_chunk_at = now
                    if last_chunk_at is not None:
                        max_chunk_gap = max(max_chunk_gap, now - last_chunk_at)
                    last_chunk_at = now

                    combined = (
                        torch.cat(accumulated_chunks, dim=0)
                        .detach()
                        .to("cpu", dtype=torch.float32)
                        .contiguous()
                    )
                    chunk_count += 1
                    audio_samples += combined.numel()
                    pcm_b64 = base64.b64encode(combined.numpy().tobytes()).decode()
                    yield _sse({"type": "audio_chunk", "data": pcm_b64})
                    accumulated_chunks = []

            # Flush any remaining chunks
            if accumulated_chunks:
                now = time.monotonic()
                if first_chunk_at is None:
                    first_chunk_at = now
                if last_chunk_at is not None:
                    max_chunk_gap = max(max_chunk_gap, now - last_chunk_at)
                last_chunk_at = now

                combined = (
                    torch.cat(accumulated_chunks, dim=0)
                    .detach()
                    .to("cpu", dtype=torch.float32)
                    .contiguous()
                )
                chunk_count += 1
                audio_samples += combined.numel()
                pcm_b64 = base64.b64encode(combined.numpy().tobytes()).decode()
                yield _sse({"type": "audio_chunk", "data": pcm_b64})

            try:
                speaker = await future
            except asyncio.CancelledError:
                logger.info("Generation cancelled.")
                yield _sse({"type": "cancelled"})
                return
            except Exception as exc:
                logger.exception("Generation failed: %s", exc)
                yield _sse(
                    {
                        "type": "error",
                        "message": f"Generation failed: {exc}",
                    }
                )
                return

        elapsed = round(time.monotonic() - start, 1)
        audio_secs = audio_samples / SAMPLE_RATE
        realtime_factor = audio_secs / elapsed if elapsed > 0 else None
        profile = _generation_profile()
        if profile is not None:
            logger.info("Generation profile: %s", profile)
        logger.info("Generation complete in %.1fs", elapsed)
        complete_event = {
            "type": "complete",
            "elapsed": elapsed,
            "speaker": speaker,
            "audio_secs": round(audio_secs, 2),
            "realtime_factor": (
                round(realtime_factor, 3) if realtime_factor is not None else None
            ),
            "chunks": chunk_count,
            "first_chunk_secs": (
                round(first_chunk_at - start, 2) if first_chunk_at is not None else None
            ),
            "max_chunk_gap_secs": round(max_chunk_gap, 2),
        }
        if profile is not None:
            complete_event["profile"] = profile
        yield _sse(complete_event)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-Content-Type-Options": "nosniff",
        },
    )
