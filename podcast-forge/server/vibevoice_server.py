"""
VibePod — VibeVoice FastAPI TTS Server

Loads microsoft/VibeVoice-Realtime-0.5B via HuggingFace transformers and
exposes a POST /generate endpoint that accepts { text, cfg_scale, inference_steps }
and returns a WAV audio blob.

Start with:
    uvicorn vibevoice_server:app --host 0.0.0.0 --port 8000
"""

import io
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from transformers import AutoProcessor, AutoModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL_ID = "microsoft/VibeVoice-Realtime-0.5B"

# ─── Global model state ────────────────────────────────────────────────────────
_processor: Optional[object] = None
_model: Optional[object] = None
_device: str = "cpu"


def _load_model() -> None:
    global _processor, _model, _device

    if _model is not None:
        return

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("Loading %s on %s …", MODEL_ID, _device)

    _processor = AutoProcessor.from_pretrained(MODEL_ID)
    _model = AutoModel.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16 if _device == "cuda" else torch.float32,
    )
    _model = _model.to(_device)
    _model.eval()

    logger.info("Model loaded successfully.")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    _load_model()
    yield


app = FastAPI(title="VibePod TTS Server", version="0.1.0", lifespan=lifespan)


# ─── Request / response schemas ────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10_000)
    cfg_scale: float = Field(default=2.5, ge=1.0, le=3.0)
    inference_steps: int = Field(default=20, ge=10, le=30)

    @field_validator("text")
    @classmethod
    def text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v.strip()


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    """Liveness probe used by the Next.js /api/health route."""
    return {"status": "online", "model": MODEL_ID}


@app.post("/generate")
async def generate(req: GenerateRequest) -> StreamingResponse:
    """
    Generate speech from text and return a WAV audio stream.
    """
    if _model is None or _processor is None:
        raise HTTPException(status_code=503, detail="Model not loaded yet — please retry in a moment.")

    logger.info(
        "Generating audio for %d chars (cfg=%.1f, steps=%d)",
        len(req.text),
        req.cfg_scale,
        req.inference_steps,
    )

    try:
        inputs = _processor(text=req.text, return_tensors="pt").to(_device)

        with torch.no_grad():
            output = _model.generate(
                **inputs,
                guidance_scale=req.cfg_scale,
                num_inference_steps=req.inference_steps,
            )

        # output is typically a tensor of shape (1, num_samples) or (num_samples,)
        audio_array = output.squeeze().cpu().numpy()

        # Normalise to [-1, 1] float32 for WAV
        if audio_array.dtype != np.float32:
            audio_array = audio_array.astype(np.float32)
        peak = np.abs(audio_array).max()
        if peak > 0:
            audio_array = audio_array / peak

        # Determine sample rate — try common attribute names
        sample_rate: int = (
            getattr(_model.config, "sampling_rate", None)
            or getattr(_model.config, "sample_rate", None)
            or 24_000
        )

        buf = io.BytesIO()
        sf.write(buf, audio_array, sample_rate, format="WAV", subtype="FLOAT")
        buf.seek(0)

        logger.info(
            "Audio generated: %.2f s at %d Hz (%d bytes)",
            len(audio_array) / sample_rate,
            sample_rate,
            buf.getbuffer().nbytes,
        )

        return StreamingResponse(
            buf,
            media_type="audio/wav",
            headers={"Content-Disposition": 'attachment; filename="vibepod-output.wav"'},
        )

    except Exception as exc:
        logger.exception("Generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

