"""HTTP surface for script-writing jobs."""

import threading
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

import episode_store as episodes

from . import jobs
from .formatting import parse
from .prompts import Brief
from .providers import ProviderError, make_provider, status

router = APIRouter()
Provider = Literal["claude", "codex", "ollama"]
MAX_BLOCKS = episodes.MAX_BLOCKS


class JobRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=600)
    minutes: int = Field(default=10, ge=1, le=60)
    speakers: list[str] = Field(default=["Alice", "Frank"], min_length=1, max_length=4)
    tone: str = Field(default=Brief.tone, max_length=200)
    angle: str = Field(default="", max_length=400)
    notes: str = Field(default="", max_length=20000)
    provider: Provider = "claude"
    model: str | None = Field(default=None, max_length=100)
    review: bool = False
    target: Literal["new", "this"] = "new"

    @field_validator("speakers")
    @classmethod
    def distinct_names(cls, names):
        cleaned = [n.strip() for n in names]
        if any(not n or ":" in n or len(n) > 38 for n in cleaned):
            raise ValueError("Speaker names must be 1-38 characters and cannot contain a colon")
        if len({n.lower() for n in cleaned}) != len(cleaned):
            raise ValueError("Speaker names must be different")
        return cleaned


class ResumeRequest(BaseModel):
    provider: Provider | None = None
    model: str | None = None


class ApplyRequest(BaseModel):
    episode_id: str | None = None
    revision: int | None = None


def _submit(request: Request, jid: str) -> None:
    cancel = threading.Event()
    request.app.state.script_cancel[jid] = cancel

    def work():
        try:
            jobs.execute(jid, cancel)
        finally:
            request.app.state.script_cancel.pop(jid, None)

    request.app.state.script_worker.submit(work)


def _job(jid: str) -> dict:
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "Script job not found")
    return job


def _require_idle(request: Request) -> None:
    if request.app.state.script_cancel:
        raise HTTPException(409, "A script is already being written")


@router.get("/script-providers")
def providers():
    return {"items": [status(name) for name in ("claude", "codex", "ollama")]}


@router.post("/script-jobs", status_code=201)
def create_job(body: JobRequest, request: Request):
    _require_idle(request)
    if body.provider == "ollama" and not body.model:
        raise HTTPException(422, "Choose an Ollama model")
    try:
        make_provider(body.provider, body.model)
    except ProviderError as exc:
        raise HTTPException(422, str(exc)) from exc
    brief = Brief(
        topic=body.topic.strip(),
        minutes=body.minutes,
        speakers=tuple(body.speakers),
        tone=body.tone.strip() or Brief.tone,
        angle=body.angle.strip(),
        notes=body.notes.strip(),
    )
    jid = jobs.create(brief, body.provider, body.model, body.review, body.target)
    _submit(request, jid)
    return _job(jid)


@router.get("/script-jobs/current")
def current_job():
    return jobs.current()


@router.get("/script-jobs/{jid}")
def get_job(jid: str):
    return _job(jid)


@router.post("/script-jobs/{jid}/cancel")
def cancel_job(jid: str, request: Request):
    _job(jid)
    event = request.app.state.script_cancel.get(jid)
    if event:
        event.set()
    return _job(jid)


@router.post("/script-jobs/{jid}/resume")
def resume_job(jid: str, body: ResumeRequest, request: Request):
    job = _job(jid)
    if job["status"] not in ("error", "cancelled"):
        raise HTTPException(409, "Only a stopped script can be resumed")
    _require_idle(request)
    if body.provider:
        jobs.update(jid, provider=body.provider, model=body.model)
    jobs.update(jid, status="queued", error=None)
    _submit(request, jid)
    return _job(jid)


@router.post("/script-jobs/{jid}/discard")
def discard_job(jid: str):
    job = _job(jid)
    if job["status"] in ("queued", "running"):
        raise HTTPException(409, "Cancel the script before discarding it")
    jobs.finish(jid, "discarded")
    return {"ok": True}


@router.post("/script-jobs/{jid}/apply")
def apply_job(jid: str, body: ApplyRequest):
    job = _job(jid)
    if job["status"] != "done":
        raise HTTPException(409, "The script is not finished")
    blocks, problems = parse(job["script"], job["brief"]["speakers"])
    if problems or not blocks:
        raise HTTPException(422, "The saved script could not be read")
    new = [{"speaker": b.speaker, "text": b.text} for b in blocks]
    research = jobs.sources(jid)
    try:
        if job["target"] == "this" and body.episode_id:
            if body.revision is None:
                raise HTTPException(422, "Save the episode first")
            result = episodes.append_script(
                body.episode_id, body.revision, new, research, MAX_BLOCKS
            )
            if not result:
                raise HTTPException(404, "Episode not found")
        else:
            if len(new) > MAX_BLOCKS:
                raise HTTPException(422, f"At most {MAX_BLOCKS} blocks fit in an episode")
            result = episodes.create(job["title"] or job["brief"]["topic"], new, sources=research)
    except episodes.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    jobs.finish(jid, "applied")
    return result
