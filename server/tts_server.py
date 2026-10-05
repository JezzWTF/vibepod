"""Persistent line takes with one serialized GPU worker."""

import io
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Literal

import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field, model_validator

import episode_export
import episode_store as episodes
import export_store as exports
import generation_store as store
import voice_store as voices
from episode_audio import assemble
from ids import take_id
from model_adapter import Cancelled, QwenAdapter
from waveform import write_peaks


@asynccontextmanager
async def lifespan(app):
    store.init_db()
    episodes.init_episodes()
    exports.init_exports()
    app.state.adapter = QwenAdapter()
    app.state.worker = ThreadPoolExecutor(max_workers=1)
    app.state.export_worker = ThreadPoolExecutor(max_workers=1)
    app.state.pending = {}
    app.state.lock = threading.Lock()
    yield
    for event in list(app.state.pending.values()):
        event.set()
    app.state.worker.shutdown(wait=True, cancel_futures=True)
    app.state.export_worker.shutdown(wait=True, cancel_futures=True)


app = FastAPI(title="VibePod Studio", lifespan=lifespan)


def progress_reporter(tid):
    last_stage, last_write = None, 0.0

    def report(stage, steps=None):
        nonlocal last_stage, last_write
        now = time.monotonic()
        if stage != last_stage or now - last_write >= 0.5:
            store.report_progress(tid, stage, steps)
            if stage != last_stage:
                logging.getLogger("uvicorn.error").info("Take %s: %s", tid, stage)
            last_stage, last_write = stage, now

    return report


class DesignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=10, max_length=1000)
    text: str = Field(
        default="Welcome to our conversation. There is always something new to discover when we take the time to listen. Today we will explore an idea together, ask a few thoughtful questions, and see where the story takes us.",
        min_length=60,
        max_length=500,
    )


def render_design(tid, request, event):
    try:
        if event.is_set():
            return
        store.start_job(tid)
        progress = progress_reporter(tid)
        audio = app.state.adapter.design(request.text, request.description, event, progress)
        if event.is_set():
            raise Cancelled()
        progress("saving_audio")
        directory = store.job_dir(tid)
        directory.mkdir(parents=True, exist_ok=True)
        wav, peaks = directory / "audio.wav", directory / "peaks.json"
        sf.write(wav, audio.samples, audio.sample_rate, subtype="PCM_16")
        progress("building_waveform")
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


@app.post("/voices/design", status_code=202)
def design_voice(request: DesignRequest):
    if not request.name.strip() or not request.description.strip():
        raise HTTPException(422, "Enter a voice name and description")
    tid, event = take_id(), threading.Event()
    store.create_job(
        tid,
        request.text,
        request.name.strip(),
        None,
        json.dumps({"description": request.description}),
        model_id="Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    )
    with app.state.lock:
        app.state.pending[tid] = event
    app.state.worker.submit(render_design, tid, request, event)
    return require_take(tid)


class SaveDesignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    take_id: str


@app.post("/voices/design/save", status_code=201)
def save_designed_voice(request: SaveDesignRequest):
    take = require_take(request.take_id)
    if take["status"] != "complete" or take["model_id"] != "Qwen3-TTS-12Hz-1.7B-VoiceDesign":
        raise HTTPException(422, "Choose a completed designed voice preview")
    samples, rate = sf.read(take["audio_path"], dtype="float32")
    try:
        return voices.save_voice(
            request.name,
            samples,
            rate,
            take["script"],
            kind="design",
            description=json.loads(take["settings_json"])["description"],
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


class TakeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice_id: str
    seed: int = Field(default=42, ge=0, le=2147483647)
    episode_id: str | None = None
    block_id: str | None = None


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
        progress = progress_reporter(tid)
        audio = app.state.adapter.synthesize(
            request.text, voice, {"seed": request.seed}, event, progress
        )
        if event.is_set():
            raise Cancelled()
        progress("saving_audio")
        directory = store.job_dir(tid)
        directory.mkdir(parents=True, exist_ok=True)
        wav, peaks = directory / "audio.wav", directory / "peaks.json"
        sf.write(wav, audio.samples, audio.sample_rate, subtype="PCM_16")
        progress("building_waveform")
        write_peaks(wav, peaks)
        store.complete_job(
            tid,
            len(audio.samples) / audio.sample_rate,
            audio.sample_rate,
            wav,
            peaks,
            on_complete=lambda conn: episodes.select_first_current_take(tid, conn),
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
    if bool(request.episode_id) != bool(request.block_id):
        raise HTTPException(422, "Episode and block must be provided together")
    if request.episode_id:
        episode = get_episode(request.episode_id)
        block = next((b for b in episode["blocks"] if b["id"] == request.block_id), None)
        if not block or block["text"] != request.text or block["voice_id"] != request.voice_id:
            raise HTTPException(
                409, "Save the current script and voice assignment before generating"
            )
    tid, event = take_id(), threading.Event()
    try:
        store.create_job(
            tid,
            request.text,
            voice["name"],
            voice["id"],
            json.dumps({"seed": request.seed}),
            request.episode_id,
            request.block_id,
        )
    except store.EpisodeUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc
    with app.state.lock:
        app.state.pending[tid] = event
    app.state.worker.submit(render, tid, request, voice, event)
    return require_take(tid)


class BlockRequest(BaseModel):
    id: str | None = None
    speaker: str = Field(min_length=1, max_length=80)
    voice_id: str | None = None
    text: str = Field(max_length=4000)
    selected_take_id: str | None = None


class EpisodeRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    blocks: list[BlockRequest] = Field(max_length=100)
    gap_secs: float = Field(default=0.25, ge=0, le=5)
    revision: int | None = None

    @model_validator(mode="after")
    def consistent_cast(self):
        cast = {}
        for block in self.blocks:
            block.speaker = block.speaker.strip()
            if not block.speaker:
                raise ValueError("Speaker name cannot be blank")
            block.voice_id = block.voice_id or None
            if block.speaker in cast and cast[block.speaker] != block.voice_id:
                raise ValueError("All blocks for a speaker must use the same voice")
            cast[block.speaker] = block.voice_id
        return self


@app.post("/episodes", status_code=201)
def create_episode(request: EpisodeRequest):
    if any(b.id or b.selected_take_id for b in request.blocks):
        raise HTTPException(422, "New episodes cannot reuse block or take IDs")
    return episodes.create(
        request.title, [b.model_dump() for b in request.blocks], request.gap_secs
    )


@app.get("/episodes")
def list_episodes(state: Literal["active", "archived", "trashed"] = "active"):
    return {"items": episodes.list_all(state), "counts": episodes.counts()}


class LifecycleRequest(BaseModel):
    action: Literal["archive", "trash", "restore"]
    revision: int = Field(ge=1)


@app.post("/episodes/{eid}/lifecycle")
def manage_episode(eid: str, request: LifecycleRequest):
    try:
        result = episodes.change_lifecycle(eid, request.action, request.revision)
    except episodes.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    if not result:
        raise HTTPException(404, "Episode not found")
    return result


@app.get("/episodes/{eid}")
def get_episode(eid: str):
    episode = episodes.get(eid)
    if not episode:
        raise HTTPException(404, "Episode not found")
    return episode


@app.put("/episodes/{eid}")
def update_episode(eid: str, request: EpisodeRequest):
    try:
        result = episodes.update(
            eid,
            request.title,
            [b.model_dump() for b in request.blocks],
            request.revision,
            request.gap_secs,
        )
    except episodes.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not result:
        raise HTTPException(404, "Episode not found")
    return result


class SelectionRequest(BaseModel):
    take_id: str
    revision: int


@app.post("/episodes/{eid}/blocks/{bid}/select")
def select_take(eid: str, bid: str, request: SelectionRequest):
    get_episode(eid)
    try:
        return episodes.select(eid, bid, request.take_id, request.revision)
    except episodes.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/episodes/{eid}/blocks/{bid}/generate", status_code=202)
def generate_block(eid: str, bid: str):
    episode = get_episode(eid)
    block = next((b for b in episode["blocks"] if b["id"] == bid), None)
    if not block:
        raise HTTPException(404, "Block not found")
    if any(t["status"] in ("queued", "generating") for t in block["takes"]):
        raise HTTPException(409, "This block already has a take in progress")
    if not block["text"].strip() or not block["voice_id"]:
        raise HTTPException(422, "Write the line and assign its speaker voice first")
    return create_take(
        TakeRequest(
            text=block["text"],
            voice_id=block["voice_id"],
            episode_id=eid,
            block_id=bid,
            seed=42 + len(block["takes"]),
        )
    )


@app.post("/episodes/{eid}/generate", status_code=202)
def generate_episode(
    eid: str, mode: str = Query(default="missing", pattern="^(all|missing|stale)$")
):
    episode = get_episode(eid)
    targets = [
        b
        for b in episode["blocks"]
        if (mode == "all" or not b["selected_take_id"] or (mode == "stale" and b["stale"]))
        and not any(t["status"] in ("queued", "generating") for t in b["takes"])
    ]
    if any(not b["text"].strip() or not voices.get_voice(b["voice_id"]) for b in targets):
        raise HTTPException(422, "Write each line and assign saved voices before generating")
    return {"takes": [generate_block(eid, b["id"]) for b in targets]}


@app.post("/episodes/{eid}/cancel")
def cancel_episode(eid: str):
    get_episode(eid)
    # Include queued takes from blocks removed by another client.
    with store._connect() as conn:
        ids = conn.execute(
            "SELECT id FROM generations WHERE episode_id=? AND status IN ('queued','generating')",
            (eid,),
        ).fetchall()
    for row in ids:
        cancel_take(row[0])
    return get_episode(eid)


@app.get("/episodes/{eid}/audio")
def episode_audio(
    eid: str,
    preview: bool = False,
    selection: str | None = Query(default=None, max_length=16000),
    gap: float | None = Query(default=None, ge=0, le=5),
):
    try:
        episode = get_episode(eid)
        if selection is not None:
            requested = selection.split(",") if selection else []
            if len(requested) != len(set(requested)):
                raise ValueError("Preview selections cannot contain duplicate takes")
            requested_ids = set(requested)
            ordered = []
            blocks = []
            for block in episode["blocks"]:
                matches = [
                    t
                    for t in block["takes"]
                    if t["id"] in requested_ids and t["status"] == "complete"
                ]
                if len(matches) > 1:
                    raise ValueError("Choose one completed take per script block")
                take_id = matches[0]["id"] if matches else None
                if take_id:
                    ordered.append(take_id)
                blocks.append({**block, "selected_take_id": take_id})
            if ordered != requested:
                raise ValueError(
                    "Preview takes must belong to this episode and follow script order"
                )
            episode = {**episode, "blocks": blocks}
        if gap is not None:
            episode = {**episode, "gap_secs": gap}
        path, _ = assemble(episode, allow_partial=preview)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return FileResponse(path, media_type="audio/wav")


@app.get("/episodes/{eid}/exports")
def list_exports(eid: str):
    get_episode(eid)
    return {"items": exports.list_all(eid)}


@app.post("/episodes/{eid}/exports", status_code=202)
async def create_export(
    eid: str,
    format: str = Form(pattern="^(wav|mp3)$"),
    title: str = Form(min_length=1, max_length=160),
    show: str = Form(default="", max_length=160),
    number: int | None = Form(default=None, ge=1, le=99999),
    artwork: UploadFile | None = File(default=None),
):
    episode = get_episode(eid)
    try:
        episode_export.ffmpeg()
        # Validate the selection without doing the assembly on the request thread.
        if not episode["blocks"] or any(
            not any(
                t["id"] == b["selected_take_id"] and t["status"] == "complete" for t in b["takes"]
            )
            for b in episode["blocks"]
        ):
            raise ValueError("Select a completed take for every block before exporting")
        data, extension = None, None
        if artwork:
            if format != "mp3":
                raise ValueError("Embedded artwork is supported for MP3 exports")
            data = await artwork.read(5 * 1024 * 1024 + 1)
            if len(data) > 5 * 1024 * 1024:
                raise ValueError("Artwork must be smaller than 5 MB")
            with Image.open(io.BytesIO(data)) as image:
                if (
                    image.format not in ("JPEG", "PNG")
                    or image.width != image.height
                    or not 64 <= image.width <= 4000
                ):
                    raise ValueError("Choose square JPG or PNG artwork, 64–4000 pixels wide")
                extension = ".jpg" if image.format == "JPEG" else ".png"
                image.verify()
        options = {"format": format, "title": title.strip(), "show": show.strip(), "number": number}
        if not options["title"]:
            raise ValueError("Enter an episode title")
        job = exports.create(episode, options)
        if data:
            directory = exports.root(job["id"])
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / ("cover" + extension)
            path.write_bytes(data)
            options["artwork"] = str(path)
            with store._connect() as conn:
                conn.execute(
                    "UPDATE exports SET options_json=? WHERE id=?", (json.dumps(options), job["id"])
                )
        app.state.export_worker.submit(episode_export.render, job["id"])
        return exports.public(exports.get(job["id"]))
    except store.EpisodeUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/episodes/{eid}/exports/{xid}/download")
def download_export(eid: str, xid: str):
    job = exports.get(xid)
    if not job or job["episode_id"] != eid or job["status"] != "complete":
        raise HTTPException(404, "Completed export not found")
    options = job["options"]
    import re

    filename = re.sub(r"[^\w .-]", "", options["title"]).strip()[:100] or "episode"
    return FileResponse(
        job["audio_path"],
        media_type="audio/mpeg" if options["format"] == "mp3" else "audio/wav",
        filename=filename + "." + options["format"],
    )


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
        try:
            store.delete_job(tid)
        except store.TakeInUse as exc:
            raise HTTPException(409, str(exc)) from exc
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
