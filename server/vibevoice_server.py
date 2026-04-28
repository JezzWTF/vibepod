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
"""

import asyncio
import base64
import copy
import functools
import json
import logging
import os
import threading
import time
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
    "davis":  "en-Davis_man.pt",
    "emma":   "en-Emma_woman.pt",
    "frank":  "en-Frank_man.pt",
    "grace":  "en-Grace_woman.pt",
    "mike":   "en-Mike_man.pt",
}
DEFAULT_SPEAKER = "carter"

_IGNORE_PATTERNS = ["*.msgpack", "flax_model*", "tf_model*", "rust_model*", "*.ot"]

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
        snapshot_download(MODEL_ID, local_files_only=True, ignore_patterns=_IGNORE_PATTERNS)
        return True
    except Exception:
        return False


def _download_model() -> None:
    from huggingface_hub import snapshot_download
    token: Optional[str] = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
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

def _load_model_sync() -> None:
    global _processor, _model, _device, _model_status, _model_error, _voice_presets

    with _load_lock:
        if _model is not None:
            return

        try:
            if not _is_model_cached():
                _model_status = "downloading"
                _download_model()

            _model_status = "loading"
            _download_voices()

            _device = "cuda" if torch.cuda.is_available() else "cpu"
            load_dtype = torch.bfloat16 if _device == "cuda" else torch.float32
            attn_impl = "flash_attention_2" if _device == "cuda" else "sdpa"

            logger.info("Loading processor...")
            from vibevoice.processor.vibevoice_streaming_processor import (
                VibeVoiceStreamingProcessor,
            )
            _processor = VibeVoiceStreamingProcessor.from_pretrained(MODEL_ID)

            logger.info("Loading model on %s...", _device)
            from vibevoice.modular.modeling_vibevoice_streaming_inference import (
                VibeVoiceStreamingForConditionalGenerationInference,
            )
            try:
                _model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    MODEL_ID,
                    torch_dtype=load_dtype,
                    device_map=_device,
                    attn_implementation=attn_impl,
                )
            except Exception:
                logger.warning("flash_attention_2 unavailable, falling back to sdpa")
                _model = VibeVoiceStreamingForConditionalGenerationInference.from_pretrained(
                    MODEL_ID,
                    torch_dtype=load_dtype,
                    device_map=_device,
                    attn_implementation="sdpa",
                )

            _model.eval()
            _model.set_ddpm_inference_steps(num_steps=10)

            for name, filename in EN_VOICES.items():
                path = VOICES_DIR / filename
                if path.exists():
                    _voice_presets[name] = torch.load(
                        path, map_location=_device, weights_only=False
                    )

            _model_status = "online"
            logger.info("Model ready on %s. Voices: %s", _device, list(_voice_presets.keys()))

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
    inference_steps: int = Field(default=10, ge=5, le=20)

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
        "voices": list(_voice_presets.keys()),
    }
    if _model_status == "downloading":
        body["progress"] = {"done": _dl_progress["done"], "total": _dl_progress["total"]}
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
    voice_preset = copy.deepcopy(_voice_presets[speaker])

    _model.set_ddpm_inference_steps(num_steps=req.inference_steps)

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

    outputs = _model.generate(
        **inputs,
        max_new_tokens=None,
        cfg_scale=req.cfg_scale,
        tokenizer=_processor.tokenizer,
        generation_config={"do_sample": False},
        verbose=True,
        all_prefilled_outputs=copy.deepcopy(voice_preset),
        audio_streamer=streamer,
    )

    if not outputs.speech_outputs or outputs.speech_outputs[0] is None:
        raise ValueError("Model returned no audio output.")

    return speaker


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@app.post("/generate")
async def generate(req: GenerateRequest, request: Request) -> StreamingResponse:
    if _model_status != "online":
        detail = {
            "downloading": "Model is downloading — please wait.",
            "loading":     "Model is loading into memory — please wait.",
            "error":       f"Model failed to load: {_model_error or 'unknown error'}",
        }.get(_model_status, "Server not ready.")
        raise HTTPException(status_code=503, detail=detail)

    if _generation_lock.locked():
        raise HTTPException(status_code=503, detail="Server is already generating audio. Please wait.")

    async def event_stream() -> AsyncGenerator[str, None]:
        from vibevoice.modular.streamer import AsyncAudioStreamer

        start = time.monotonic()
        streamer = AsyncAudioStreamer(batch_size=1)
        cancel_event = threading.Event()

        async with _generation_lock:
            loop = asyncio.get_event_loop()
            future = loop.run_in_executor(
                None, functools.partial(_sync_generate, req, streamer, cancel_event)
            )

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

                pcm_b64 = base64.b64encode(
                    chunk.detach().cpu().float().numpy().tobytes()
                ).decode()
                yield _sse({"type": "audio_chunk", "data": pcm_b64})

            try:
                speaker = await future
            except asyncio.CancelledError:
                logger.info("Generation cancelled.")
                yield _sse({"type": "cancelled"})
                return
            except Exception as exc:
                logger.exception("Generation failed: %s", exc)
                yield _sse({"type": "error", "message": "Internal server error during generation."})
                return

        elapsed = round(time.monotonic() - start, 1)
        logger.info("Generation complete in %.1fs", elapsed)
        yield _sse({"type": "complete", "elapsed": elapsed, "speaker": speaker})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

