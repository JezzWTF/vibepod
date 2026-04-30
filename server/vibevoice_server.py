"""
VibePod — VibeVoice FastAPI TTS Server

Startup sequence (background thread):
  1. Download model weights if not cached   -> status: downloading
  2. Download voice preset .pt files        -> status: loading
  3. Load processor + model into memory     -> status: loading
  4. Pre-load all voice tensors             -> status: loading
  -> Server ready                           -> status: online

Generation flow:
  POST /generate   -> SSE stream of audio_chunk events (base64 float32 PCM),
                      ends with {type:"complete"}

Device selection:
  Set VIBEPOD_DEVICE=cpu  to force CPU inference (e.g. via --cpu flag in start.sh).
  Set VIBEPOD_DEVICE=cuda to force CUDA (default when a GPU is available).
  If unset, the server auto-detects: CUDA if available, otherwise CPU.
"""

import asyncio
import base64
import copy
import functools
import importlib.util
import json
import logging
import os
import threading
import time
import types
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Literal, Optional

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
VOICE_BASE_URL = (
    "https://raw.githubusercontent.com/microsoft/VibeVoice/main"
    "/demo/voices/streaming_model"
)

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

# ── Device selection ────────────────────────────────────────────────────────────
# VIBEPOD_DEVICE env var is set by start.sh based on the --cpu / --cuda flag.
# Falls back to auto-detection if not set.


def _resolve_device() -> str:
    """Resolve the target device from env var or auto-detect."""
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
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Invalid value for %s=%r — using default %d", name, raw, default)
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Invalid value for %s=%r — using default %g", name, raw, default)
        return default


# ── Global state ────────────────────────────────────────────────────────────────

ModelStatus = Literal["downloading", "loading", "online", "error"]

_processor = None
_model = None
_device: str = "cpu"
_model_status: ModelStatus = "loading"
_model_error: Optional[str] = None
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

    token: Optional[str] = os.environ.get("HF_TOKEN") or os.environ.get(
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
    for name, filename in EN_VOICES.items():
        dest = VOICES_DIR / filename
        if not dest.exists():
            url = f"{VOICE_BASE_URL}/{filename}"
            logger.info("Downloading voice preset: %s", filename)
            urllib.request.urlretrieve(url, dest)
    logger.info("Voice presets ready.")


# ── Background model loader ─────────────────────────────────────────────────────


def _init_processor():
    logger.info("Loading processor...")
    from vibevoice.processor.vibevoice_streaming_processor import (
        VibeVoiceStreamingProcessor,
    )

    return VibeVoiceStreamingProcessor.from_pretrained(MODEL_ID)


def _init_model(device: str):
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

    cuda_dtype = os.environ.get("VIBEPOD_CUDA_DTYPE", "bf16").lower()
    if device == "cuda" and cuda_dtype == "fp16":
        load_dtype = torch.float16
    else:
        load_dtype = torch.bfloat16 if device == "cuda" else torch.float32
    logger.info("Loading model weights with dtype %s", load_dtype)
    requested_attn_impl = os.environ.get("VIBEPOD_ATTN_IMPL", "auto").lower()
    has_flash_attn = importlib.util.find_spec("flash_attn") is not None
    if requested_attn_impl in {"eager", "sdpa"}:
        attn_impl = requested_attn_impl
    elif requested_attn_impl == "flash_attention_2":
        attn_impl = "flash_attention_2" if has_flash_attn else "sdpa"
    else:
        attn_impl = "flash_attention_2" if device == "cuda" and has_flash_attn else "sdpa"
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
    model.set_ddpm_inference_steps(num_steps=_config["default_inference_steps"])
    _install_generation_optimizations(model)
    return model


def _install_generation_optimizations(model: object) -> None:
    """Patch VibeVoice hot paths without changing model quality settings."""

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
                profile_record(self, "diffusion_prediction_head", time.perf_counter() - started)
            cond_eps, uncond_eps = torch.split(eps, batch_size, dim=0)
            guided_eps = uncond_eps + cfg_scale * (cond_eps - uncond_eps)
            if profile_enabled():
                started = time.perf_counter()
            speech = scheduler.step(guided_eps, t, speech).prev_sample
            if profile_enabled():
                profile_record(self, "diffusion_scheduler_step", time.perf_counter() - started)

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
    presets = {}
    for name, filename in EN_VOICES.items():
        path = VOICES_DIR / filename
        if path.exists():
            presets[name] = torch.load(path, map_location=device, weights_only=False)
    return presets


def _load_model_sync() -> None:
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
            _config["prebuffer_secs"] = _env_float("VIBEPOD_PREBUFFER_SECS", 6.0 if is_cpu else 5.0)
            _config["rebuffer_threshold_secs"] = _env_float("VIBEPOD_REBUFFER_THRESHOLD_SECS", 1.5 if is_cpu else 1.0)
            _config["resume_threshold_secs"] = _env_float("VIBEPOD_RESUME_THRESHOLD_SECS", 4.0 if is_cpu else 3.0)
            _config["default_inference_steps"] = _env_int("VIBEPOD_DEFAULT_INFERENCE_STEPS", 8 if is_cpu else 10)

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


app = FastAPI(title="VibePod TTS Server", version="0.1.0", lifespan=lifespan)


# ── Schemas ─────────────────────────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    speaker: str = Field(default=DEFAULT_SPEAKER)
    cfg_scale: float = Field(default=1.5, ge=0.5, le=4.0)
    inference_steps: Optional[int] = Field(default=None, ge=5, le=20)

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
    streamer: Optional[object] = None,
    cancel_event: Optional[threading.Event] = None,
) -> str:
    """Blocking inference. Returns the speaker used.
    Runs in a thread-pool executor — do not call from the event loop directly.
    Pass an AsyncAudioStreamer to receive audio chunks in real time.
    """
    if cancel_event and cancel_event.is_set():
        raise RuntimeError("Generation cancelled.")

    speaker = req.speaker if req.speaker in _voice_presets else DEFAULT_SPEAKER
    model_dtype = _model_float_dtype()
    voice_preset = _move_cached_prompt(
        copy.deepcopy(_voice_presets[speaker]), _device, model_dtype
    )

    steps = req.inference_steps if req.inference_steps is not None else _config["default_inference_steps"]
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


def _generation_profile() -> Optional[dict[str, dict[str, float]]]:
    if os.environ.get("VIBEPOD_PROFILE_GENERATION", "0") != "1":
        return None
    stats = getattr(_model, "_vibepod_profile", None)
    if not stats:
        return {}
    return {
        key: {
            "count": value["count"],
            "seconds": round(value["seconds"], 3),
            "avg_ms": round(value["seconds"] * 1000 / value["count"], 3)
            if value["count"]
            else 0.0,
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

            def put(self, audio_chunks: torch.Tensor, sample_indices: torch.Tensor) -> None:
                for i, sample_idx in enumerate(sample_indices):
                    idx = sample_idx.item()
                    if idx < self.batch_size and not self.finished_flags[idx]:
                        self.loop.call_soon_threadsafe(
                            self.audio_queues[idx].put_nowait,
                            audio_chunks[i].detach(),
                        )

            def end(self, sample_indices: Optional[torch.Tensor] = None) -> None:
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
        first_chunk_at: Optional[float] = None
        last_chunk_at: Optional[float] = None
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
            "realtime_factor": round(realtime_factor, 3)
            if realtime_factor is not None
            else None,
            "chunks": chunk_count,
            "first_chunk_secs": round(first_chunk_at - start, 2)
            if first_chunk_at is not None
            else None,
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
