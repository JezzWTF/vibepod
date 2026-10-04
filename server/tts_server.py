"""Persistent line takes with one serialized GPU worker."""

import io
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import generation_store as store
import voice_store as voices
from ids import take_id
from model_adapter import Cancelled, QwenAdapter
from waveform import write_peaks


@asynccontextmanager
async def lifespan(app):
    store.init_db()
    app.state.adapter = QwenAdapter()
    app.state.worker = ThreadPoolExecutor(max_workers=1)
    app.state.pending = {}
    app.state.lock = threading.Lock()
    yield
    for event in list(app.state.pending.values()):
        event.set()
    app.state.worker.shutdown(wait=True, cancel_futures=True)


app = FastAPI(title="VibePod Studio", lifespan=lifespan)


class TakeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice_id: str
    seed: int = Field(default=42, ge=0, le=2147483647)


def require_take(tid):
    row = store.get_job(tid)
    if not row:
        raise HTTPException(404, "Take not found")
    return row


def render(tid, request, voice, event):
    try:
        if event.is_set():
            return
        store.start_job(tid)
        audio = app.state.adapter.synthesize(request.text, voice, {"seed": request.seed}, event)
        if event.is_set():
            raise Cancelled()
        directory = store.job_dir(tid)
        directory.mkdir(parents=True, exist_ok=True)
        wav, peaks = directory / "audio.wav", directory / "peaks.json"
        sf.write(wav, audio.samples, audio.sample_rate, subtype="PCM_16")
        write_peaks(wav, peaks)
        store.complete_job(
            tid, len(audio.samples) / audio.sample_rate, audio.sample_rate, wav, peaks
        )
    except Cancelled:
        store.cancel_job(tid)
    except Exception as exc:
        store.fail_job(tid, str(exc))
    finally:
        with app.state.lock:
            app.state.pending.pop(tid, None)


@app.get("/health")
def health():
    return {
        "status": "online",
        "device": "CUDA",
        "model": "Qwen3-TTS 1.7B",
        "voices": voices.list_voices(),
    }


@app.get("/voices")
def list_voices():
    return voices.list_voices()


@app.post("/voices", status_code=201)
async def clone_voice(
    name: str = Form(min_length=1, max_length=80),
    transcript: str = Form(default="", max_length=4000),
    file: UploadFile = File(),
):
    data = await file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Reference must be smaller than 10 MB")
    try:
        samples, rate = sf.read(io.BytesIO(data), dtype="float32")
        return voices.save_voice(name, samples, rate, transcript)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/takes", status_code=202)
def create_take(request: TakeRequest):
    if not request.text.strip():
        raise HTTPException(422, "Enter a line of speech")
    voice = voices.get_voice(request.voice_id)
    if not voice:
        raise HTTPException(404, "Voice not found")
    tid, event = take_id(), threading.Event()
    store.create_job(
        tid, request.text, voice["name"], voice["id"], json.dumps({"seed": request.seed})
    )
    with app.state.lock:
        app.state.pending[tid] = event
    app.state.worker.submit(render, tid, request, voice, event)
    return require_take(tid)


@app.get("/generations")
@app.get("/takes")
def list_takes(limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
    return {"items": store.list_jobs(limit, offset), "limit": limit, "offset": offset}


@app.get("/generations/{tid}")
@app.get("/takes/{tid}")
def get_take(tid: str):
    return require_take(tid)


@app.post("/takes/{tid}/cancel")
def cancel_take(tid: str):
    require_take(tid)
    with app.state.lock:
        event = app.state.pending.get(tid)
        if event:
            event.set()
    store.cancel_job(tid)
    return require_take(tid)


@app.delete("/generations/{tid}")
@app.delete("/takes/{tid}")
def delete_take(tid: str):
    require_take(tid)
    with app.state.lock:
        if tid in app.state.pending:
            raise HTTPException(409, "Wait for the take to finish cancelling before deleting it")
        store.delete_job(tid)
    return {"deleted": tid}


@app.get("/generations/{tid}/{asset}")
@app.get("/takes/{tid}/{asset}")
def take_asset(tid: str, asset: str):
    row = require_take(tid)
    key = {"audio": "audio_path", "waveform": "waveform_path"}.get(asset)
    if not key or row["status"] != "complete" or not row[key]:
        raise HTTPException(404, "Take asset not available")
    return FileResponse(
        row[key], media_type="audio/wav" if asset == "audio" else "application/json"
    )
