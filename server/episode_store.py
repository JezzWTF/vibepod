"""SQLite persistence for script-first episodes and their blocks."""

import uuid
from datetime import UTC, datetime

from generation_store import DB_PATH, _connect


def _id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def init_episodes():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS script_blocks (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, position INTEGER NOT NULL, speaker TEXT NOT NULL, voice_id TEXT, text TEXT NOT NULL, selected_take_id TEXT)"
        )


def create(title, blocks):
    eid, now = _id("episode"), datetime.now(UTC).isoformat()
    with _connect() as conn:
        conn.execute("INSERT INTO episodes VALUES (?,?,?,?)", (eid, title, now, now))
        for pos, block in enumerate(blocks):
            conn.execute(
                "INSERT INTO script_blocks VALUES (?,?,?,?,?,?,?)",
                (
                    _id("block"),
                    eid,
                    pos,
                    block.get("speaker", "Speaker"),
                    block.get("voice_id"),
                    block["text"],
                    None,
                ),
            )
    return get(eid)


def get(eid):
    with _connect() as conn:
        episode = conn.execute("SELECT * FROM episodes WHERE id=?", (eid,)).fetchone()
        if not episode:
            return None
        blocks = conn.execute(
            "SELECT * FROM script_blocks WHERE episode_id=? ORDER BY position", (eid,)
        ).fetchall()
    result = dict(episode)
    result["blocks"] = [dict(row) for row in blocks]
    return result


def list_all():
    with _connect() as conn:
        ids = [row[0] for row in conn.execute("SELECT id FROM episodes ORDER BY updated_at DESC")]
    return [get(eid) for eid in ids]


def update(eid, title, blocks):
    now = datetime.now(UTC).isoformat()
    with _connect() as conn:
        if not conn.execute("SELECT 1 FROM episodes WHERE id=?", (eid,)).fetchone():
            return None
        conn.execute("UPDATE episodes SET title=?,updated_at=? WHERE id=?", (title, now, eid))
        conn.execute("DELETE FROM script_blocks WHERE episode_id=?", (eid,))
        for pos, block in enumerate(blocks):
            conn.execute(
                "INSERT INTO script_blocks VALUES (?,?,?,?,?,?,?)",
                (
                    block.get("id", _id("block")),
                    eid,
                    pos,
                    block.get("speaker", "Speaker"),
                    block.get("voice_id"),
                    block["text"],
                    block.get("selected_take_id"),
                ),
            )
    return get(eid)
