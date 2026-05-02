"""SQLite persistence for VibePod generation jobs.

Schema lives here. The database is created on first use at:
  <repo_root>/data/db/vibepod.db

All writes go through this module. The Next.js layer reads the same file
via better-sqlite3 for project-level data in later phases.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

# Paths relative to the repo root (one level up from this file's directory).
_REPO_ROOT = Path(__file__).parent.parent
DATA_DIR = _REPO_ROOT / "data"
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


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create the database directory, database file, and tables if they don't exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    GENERATIONS_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(_CREATE_GENERATIONS)


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
    created_at = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO generations
                (id, created_at, status, script, speaker, cfg_scale, inference_steps,
                 duration_secs, sample_rate, audio_path, waveform_path)
            VALUES (?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, created_at, script, speaker, cfg_scale, inference_steps,
                round(duration_secs, 3), sample_rate, audio_path, waveform_path,
            ),
        )


def cancel_job(job_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status = 'cancelled' WHERE id = ?",
            (job_id,),
        )


def fail_job(job_id: str, error_message: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE generations SET status = 'error', error_message = ? WHERE id = ?",
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
        row = conn.execute(
            "SELECT * FROM generations WHERE id = ?", (job_id,)
        ).fetchone()
    return dict(row) if row else None


def delete_job(job_id: str) -> bool:
    """Delete the job record and its files. Returns True if the record existed."""
    job_dir = GENERATIONS_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir)

    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM generations WHERE id = ?", (job_id,)
        )
    return result.rowcount > 0


def job_dir(job_id: str) -> Path:
    return GENERATIONS_DIR / job_id
