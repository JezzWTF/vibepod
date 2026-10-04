"""Durable export snapshots and progress, independent of the GPU queue."""

import json
import uuid
from datetime import UTC, datetime

import generation_store as store


def init_exports():
    with store._connect() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL, progress REAL NOT NULL, snapshot_json TEXT NOT NULL, options_json TEXT NOT NULL, audio_path TEXT, error TEXT, measured_lufs REAL)"
        )
        conn.execute(
            "UPDATE exports SET status='error',stage='Interrupted',error='Export interrupted by server restart' WHERE status IN ('queued','running')"
        )


def root(eid):
    return store.DB_PATH.parent.parent / "exports" / eid


def create(episode, options):
    eid = "export_" + uuid.uuid4().hex
    with store._connect() as conn:
        conn.execute(
            "INSERT INTO exports (id,episode_id,created_at,status,stage,progress,snapshot_json,options_json) VALUES (?,?,?,'queued','Queued',0,?,?)",
            (
                eid,
                episode["id"],
                datetime.now(UTC).isoformat(),
                json.dumps(episode),
                json.dumps(options),
            ),
        )
    return get(eid)


def get(eid):
    with store._connect() as conn:
        row = conn.execute("SELECT * FROM exports WHERE id=?", (eid,)).fetchone()
    if not row:
        return None
    result = dict(row)
    result["options"] = json.loads(result.pop("options_json"))
    result["snapshot"] = json.loads(result.pop("snapshot_json"))
    return result


def public(row):
    return {k: v for k, v in row.items() if k not in ("snapshot", "audio_path")}


def list_all(episode_id):
    with store._connect() as conn:
        ids = conn.execute(
            "SELECT id FROM exports WHERE episode_id=? ORDER BY created_at DESC", (episode_id,)
        ).fetchall()
    return [public(get(row[0])) for row in ids]


def update(eid, **values):
    allowed = {"status", "stage", "progress", "audio_path", "error", "measured_lufs"}
    if not values or not set(values).issubset(allowed):
        raise ValueError("Invalid export update")
    with store._connect() as conn:
        conn.execute(
            f"UPDATE exports SET {','.join(f'{k}=?' for k in values)} WHERE id=?",
            (*values.values(), eid),
        )


def uses_pending_take(tid):
    with store._connect() as conn:
        rows = conn.execute(
            "SELECT snapshot_json FROM exports WHERE status IN ('queued','running')"
        ).fetchall()
    return any(
        any(block["selected_take_id"] == tid for block in json.loads(row[0])["blocks"])
        for row in rows
    )
