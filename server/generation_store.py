"""SQLite persistence for VibePod generation jobs.

Schema lives here. The database is created on first use at:
  <repo_root>/data/db/vibepod.db

All writes go through this module. Next.js reads via the API; future episode
relationships are added alongside these compatible Phase 1 rows.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

# Paths relative to the repo root (one level up from this file's directory).
_REPO_ROOT = Path(__file__).parent.parent
DATA_DIR = Path(os.environ.get("VIBEPOD_DATA_DIR", str(_REPO_ROOT / "data"))).expanduser().resolve()
DB_PATH = DATA_DIR / "db" / "vibepod.db"
GENERATIONS_DIR = DATA_DIR / "generations"

_CREATE_GENERATIONS = """
CREATE TABLE IF NOT EXISTS generations (
    id              TEXT PRIMARY KEY,
    created_at      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'generating',
    script          TEXT NOT NULL,
    speaker         TEXT NOT NULL,
    cfg_scale       REAL NOT NULL,
    inference_steps INTEGER,
    duration_secs   REAL,
    sample_rate     INTEGER,
    audio_path      TEXT,
    waveform_path   TEXT,
    error_message   TEXT
)
"""


@contextmanager
def _connect():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Create the database directory, database file, and tables if they don't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    GENERATIONS_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(_CREATE_GENERATIONS)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(generations)")}
        for name in ("voice_id", "model_id", "settings_json", "episode_id", "block_id"):
            if name not in columns:
                conn.execute(f"ALTER TABLE generations ADD COLUMN {name} TEXT")
        for name, definition in (
            ("stage", "TEXT"),
            ("started_at", "TEXT"),
            ("progress_at", "TEXT"),
            ("decoder_steps", "INTEGER NOT NULL DEFAULT 0"),
        ):
            if name not in columns:
                conn.execute(f"ALTER TABLE generations ADD COLUMN {name} {definition}")
        conn.execute(
            "UPDATE generations SET status='error',stage='interrupted', error_message='Interrupted by server restart' WHERE status IN ('queued', 'generating')"
        )


def create_job(
    job_id,
    text,
    voice,
    voice_id,
    settings_json,
    episode_id=None,
    block_id=None,
    model_id="Qwen3-TTS-12Hz-1.7B-Base",
):
    with _connect() as conn:
        conn.execute(
            "INSERT INTO generations (id,created_at,status,script,speaker,cfg_scale,voice_id,model_id,settings_json,episode_id,block_id) VALUES (?,?,'queued',?,?,0,?,?,?,?,?)",
            (
                job_id,
                datetime.now(UTC).isoformat(),
                text,
                voice,
                voice_id,
                model_id,
                settings_json,
                episode_id,
                block_id,
            ),
        )


def start_job(job_id):
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status='generating',stage='preparing',started_at=?,progress_at=? WHERE id=? AND status='queued'",
            (datetime.now(UTC).isoformat(), datetime.now(UTC).isoformat(), job_id),
        )


def report_progress(job_id, stage, steps=None):
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET stage=?,decoder_steps=COALESCE(?,decoder_steps),progress_at=? WHERE id=? AND status='generating'",
            (stage, steps, datetime.now(UTC).isoformat(), job_id),
        )


def complete_job(job_id, duration, rate, audio, peaks, on_complete=None):
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status='complete',stage='complete',duration_secs=?,sample_rate=?,audio_path=?,waveform_path=? WHERE id=? AND status='generating'",
            (duration, rate, str(audio), str(peaks), job_id),
        )
        if on_complete:
            on_complete(conn)


def save_completed_job(
    job_id: str,
    script: str,
    speaker: str,
    cfg_scale: float,
    inference_steps: int | None,
    duration_secs: float,
    sample_rate: int,
    audio_path: str,
    waveform_path: str,
) -> None:
    """Insert a completed generation in a single write — no intermediate 'generating' row."""
    created_at = datetime.now(UTC).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO generations
                (id, created_at, status, script, speaker, cfg_scale, inference_steps,
                 duration_secs, sample_rate, audio_path, waveform_path)
            VALUES (?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                created_at,
                script,
                speaker,
                cfg_scale,
                inference_steps,
                round(duration_secs, 3),
                sample_rate,
                audio_path,
                waveform_path,
            ),
        )


def cancel_job(job_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status = 'cancelled',stage='cancelled' WHERE id = ? AND status IN ('queued','generating')",
            (job_id,),
        )


def fail_job(job_id: str, error_message: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status = 'error',stage='error', error_message = ? WHERE id = ? AND status IN ('queued','generating')",
            (error_message[:2000], job_id),
        )


def list_jobs(limit: int = 50, offset: int = 0) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [dict(row) for row in rows]


def get_job(job_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM generations WHERE id = ?", (job_id,)).fetchone()
    return dict(row) if row else None


class TakeInUse(ValueError):
    pass


def delete_job(job_id: str) -> bool:
    """Delete the job record and its files. Returns True if the record existed."""
    directory = job_dir(job_id)
    with _connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if (
            "script_blocks" in tables
            and conn.execute(
                "SELECT 1 FROM script_blocks WHERE selected_take_id=?", (job_id,)
            ).fetchone()
        ):
            raise TakeInUse("Select another take in the episode before deleting this one")
        if "exports" in tables:
            snapshots = conn.execute(
                "SELECT snapshot_json FROM exports WHERE status IN ('queued','running')"
            ).fetchall()
            if any(
                block["selected_take_id"] == job_id
                for row in snapshots
                for block in json.loads(row[0])["blocks"]
            ):
                raise TakeInUse("Wait for the episode export to finish before deleting this take")
        result = conn.execute("DELETE FROM generations WHERE id = ?", (job_id,))
    if result.rowcount and directory.exists():
        shutil.rmtree(directory)
    return result.rowcount > 0


def job_dir(job_id: str) -> Path:
    if not job_id or any(
        c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for c in job_id
    ):
        raise ValueError("Invalid take ID")
    return GENERATIONS_DIR / job_id
