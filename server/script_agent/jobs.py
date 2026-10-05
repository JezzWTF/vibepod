"""Durable script-writing jobs. A job is a row plus a run directory of finished stages."""

import json
import re
import shutil
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from generation_store import DATA_DIR, _connect

from .pipeline import Pipeline, PipelineError
from .prompts import Brief
from .providers import Cancelled, ProviderError, make_provider

RUNS = DATA_DIR / "script_runs"
OPEN = ("queued", "running", "done", "error", "cancelled")
_SCHEMA = """
CREATE TABLE IF NOT EXISTS script_jobs (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL, stage TEXT, step INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL, model TEXT,
    review INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT 'new',
    brief_json TEXT NOT NULL, title TEXT, error TEXT, timings_json TEXT NOT NULL DEFAULT '{}'
)
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def init() -> None:
    with _connect() as conn:
        conn.execute(_SCHEMA)
        conn.execute(
            "UPDATE script_jobs SET status='error', error='Interrupted by server restart', updated_at=? WHERE status IN ('queued','running')",
            (_now(),),
        )


def create(brief: Brief, provider: str, model: str | None, review: bool, target: str) -> str:
    jid = "script_" + uuid.uuid4().hex[:12]
    with _connect() as conn:
        conn.execute(
            "INSERT INTO script_jobs (id,created_at,updated_at,status,provider,model,review,target,brief_json) VALUES (?,?,?,'queued',?,?,?,?,?)",
            (jid, _now(), _now(), provider, model, int(review), target, json.dumps(brief.__dict__)),
        )
    return jid


def update(jid: str, **fields) -> None:
    fields["updated_at"] = _now()
    assignments = ",".join(f"{key}=?" for key in fields)
    with _connect() as conn:
        conn.execute(f"UPDATE script_jobs SET {assignments} WHERE id=?", (*fields.values(), jid))


def _row(jid: str):
    with _connect() as conn:
        return conn.execute("SELECT * FROM script_jobs WHERE id=?", (jid,)).fetchone()


def run_dir(jid: str) -> Path:
    return RUNS / jid


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _sections(directory: Path) -> list[str]:
    done = []
    for path in sorted(directory.glob("section_??.txt")):
        reviewed = path.with_suffix(".reviewed.txt")
        done.append(_read(reviewed if reviewed.exists() else path))
    return done


def get(jid: str) -> dict | None:
    row = _row(jid)
    if not row:
        return None
    job = dict(row)
    brief = json.loads(job.pop("brief_json"))
    directory = run_dir(jid)
    notes = _read(directory / "research.md")
    outline = _read(directory / "outline.json")
    sections = json.loads(outline)["sections"] if outline else []
    drafted = _sections(directory)
    lines = [line for text in drafted for line in text.splitlines() if line.strip()]
    job.update(
        brief=brief,
        timings=json.loads(job.pop("timings_json")),
        review=bool(job["review"]),
        research={
            "done": bool(notes),
            "sources": len(set(re.findall(r"https?://[^\s)\]]+", notes))),
        },
        outline={"done": bool(outline), "sections": len(sections)},
        drafted=len(drafted),
        blocks=len(lines),
        lines=lines[-12:],
        script=_read(directory / "script.txt") if job["status"] in ("done", "applied") else "",
    )
    return job


def sources(jid: str) -> str:
    """The research notes, or the user's own notes when the backend could not search."""
    notes = _read(run_dir(jid) / "research.md")
    if notes:
        return notes
    row = _row(jid)
    return json.loads(row["brief_json"]).get("notes", "") if row else ""


def current() -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            f"SELECT id FROM script_jobs WHERE status IN ({','.join('?' * len(OPEN))}) ORDER BY created_at DESC LIMIT 1",
            OPEN,
        ).fetchone()
    return get(row["id"]) if row else None


def finish(jid: str, status: str) -> None:
    """Mark a job applied or discarded; discarding also removes its run folder."""
    update(jid, status=status)
    if status == "discarded":
        shutil.rmtree(run_dir(jid), ignore_errors=True)


def execute(jid: str, cancel: threading.Event) -> None:
    row = _row(jid)
    brief = Brief(
        **{
            **json.loads(row["brief_json"]),
            "speakers": tuple(json.loads(row["brief_json"])["speakers"]),
        }
    )
    timings = json.loads(row["timings_json"])
    clock = {"stage": None, "at": time.monotonic()}

    def progress(stage: str, step: int, total: int) -> None:
        now = time.monotonic()
        if clock["stage"] and clock["stage"] != stage:
            timings[clock["stage"]] = round(timings.get(clock["stage"], 0) + now - clock["at"], 1)
            clock["at"] = now
        elif not clock["stage"]:
            clock["at"] = now
        clock["stage"] = stage
        update(jid, stage=stage, step=step, total=total, timings_json=json.dumps(timings))

    update(jid, status="running", error=None)
    try:
        provider = make_provider(row["provider"], row["model"])
        pipeline = Pipeline(
            provider,
            brief,
            run_dir(jid),
            review=bool(row["review"]),
            research=provider.supports_web or bool(brief.notes),
            cancel=cancel,
            progress=progress,
        )
        title, _ = pipeline.run()
        if clock["stage"]:
            timings[clock["stage"]] = round(
                timings.get(clock["stage"], 0) + time.monotonic() - clock["at"], 1
            )
        update(jid, status="done", title=title, stage="Done", timings_json=json.dumps(timings))
    except Cancelled:
        update(jid, status="cancelled", error=None)
    except (ProviderError, PipelineError) as exc:
        update(jid, status="error", error=str(exc))
    except Exception as exc:  # keep the worker alive and tell the user
        update(jid, status="error", error=f"Unexpected failure: {exc}")
