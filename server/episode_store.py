"""Durable scripts, immutable take histories, and explicit take selections."""

import uuid
from contextlib import nullcontext
from datetime import UTC, datetime

import generation_store as store

MAX_BLOCKS = 500


class Conflict(ValueError):
    pass


def _id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def init_episodes():
    with store._connect() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        columns = {row[1] for row in conn.execute("PRAGMA table_info(episodes)")}
        for name, definition in (
            ("revision", "INTEGER NOT NULL DEFAULT 1"),
            ("gap_secs", "REAL NOT NULL DEFAULT 0.25"),
            ("lifecycle", "TEXT NOT NULL DEFAULT 'active'"),
            ("trash_previous", "TEXT"),
            ("sources", "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in columns:
                conn.execute(f"ALTER TABLE episodes ADD COLUMN {name} {definition}")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS script_blocks (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE, position INTEGER NOT NULL, speaker TEXT NOT NULL, voice_id TEXT, text TEXT NOT NULL, selected_take_id TEXT)"
        )


def _write_blocks(conn, eid, blocks):
    for position, block in enumerate(blocks):
        conn.execute(
            "INSERT INTO script_blocks VALUES (?,?,?,?,?,?,?)",
            (
                block.get("id") or _id("block"),
                eid,
                position,
                block["speaker"],
                block.get("voice_id"),
                block["text"],
                block.get("selected_take_id"),
            ),
        )


def create(title, blocks, gap_secs=0.25, sources=""):
    eid, now = _id("episode"), datetime.now(UTC).isoformat()
    with store._connect() as conn:
        conn.execute(
            "INSERT INTO episodes (id,title,created_at,updated_at,gap_secs,sources) VALUES (?,?,?,?,?,?)",
            (eid, title, now, now, gap_secs, sources),
        )
        _write_blocks(conn, eid, blocks)
    return get(eid)


def get(eid, include_trashed=False):
    with store._connect() as conn:
        # One read transaction keeps the script and take selection consistent.
        conn.execute("BEGIN")
        episode = conn.execute("SELECT * FROM episodes WHERE id=?", (eid,)).fetchone()
        if not episode or (episode["lifecycle"] == "trashed" and not include_trashed):
            return None
        blocks = conn.execute(
            "SELECT * FROM script_blocks WHERE episode_id=? ORDER BY position", (eid,)
        ).fetchall()
        takes = conn.execute(
            "SELECT * FROM generations WHERE episode_id=? ORDER BY created_at", (eid,)
        ).fetchall()
    result = dict(episode)
    result["blocks"] = []
    result["cast"] = {}
    for row in blocks:
        block = dict(row)
        block["takes"] = [dict(take) for take in takes if take["block_id"] == block["id"]]
        selected = next(
            (take for take in block["takes"] if take["id"] == block["selected_take_id"]), None
        )
        block["stale"] = bool(
            selected
            and (selected["script"] != block["text"] or selected["voice_id"] != block["voice_id"])
        )
        result["blocks"].append(block)
        result["cast"][block["speaker"]] = block["voice_id"]
    return result


def list_all(state="active"):
    if state not in ("active", "archived", "trashed"):
        raise ValueError("Unknown episode state")
    with store._connect() as conn:
        rows = conn.execute(
            "SELECT e.*,COUNT(b.id) AS block_count FROM episodes e LEFT JOIN script_blocks b ON e.id=b.episode_id WHERE e.lifecycle=? GROUP BY e.id ORDER BY e.updated_at DESC",
            (state,),
        ).fetchall()
    return [dict(row) for row in rows]


def counts():
    result = dict.fromkeys(("active", "archived", "trashed"), 0)
    with store._connect() as conn:
        result.update(
            dict(conn.execute("SELECT lifecycle,COUNT(*) FROM episodes GROUP BY lifecycle"))
        )
    return result


def change_lifecycle(eid, action, revision):
    """Organize episodes without discarding scripts, selections or audio assets."""
    with store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        episode = conn.execute("SELECT * FROM episodes WHERE id=?", (eid,)).fetchone()
        if not episode:
            return None
        if episode["revision"] != revision:
            raise Conflict("Episode changed elsewhere. Reload before managing it.")
        previous = episode["trash_previous"]
        state = episode["lifecycle"]
        if action == "archive" and state == "active":
            target = "archived"
        elif action == "trash" and state in ("active", "archived"):
            if (
                conn.execute(
                    "SELECT 1 FROM generations WHERE episode_id=? AND status IN ('queued','generating')",
                    (eid,),
                ).fetchone()
                or conn.execute(
                    "SELECT 1 FROM exports WHERE episode_id=? AND status IN ('queued','running')",
                    (eid,),
                ).fetchone()
            ):
                raise Conflict("Wait for generation and export to finish before moving to Trash.")
            target, previous = "trashed", state
        elif action == "restore" and state in ("archived", "trashed"):
            target = previous or "active" if state == "trashed" else "active"
            previous = None
        else:
            raise Conflict("This action is unavailable for the episode's current state.")
        conn.execute(
            "UPDATE episodes SET lifecycle=?,trash_previous=?,revision=revision+1,updated_at=? WHERE id=?",
            (target, previous, datetime.now(UTC).isoformat(), eid),
        )
    return get(eid, include_trashed=True)


def update(eid, title, blocks, revision, gap_secs=0.25, sources=None):
    now = datetime.now(UTC).isoformat()
    with store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        episode = conn.execute(
            "SELECT revision,lifecycle FROM episodes WHERE id=?", (eid,)
        ).fetchone()
        if not episode:
            return None
        if episode[0] != revision:
            raise Conflict("Episode changed elsewhere. Reload before saving.")
        if episode["lifecycle"] == "trashed":
            raise Conflict("Restore this episode from Trash before editing.")
        owned = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT id,selected_take_id FROM script_blocks WHERE episode_id=?", (eid,)
            )
        }
        ids = [b.get("id") for b in blocks if b.get("id")]
        if len(ids) != len(set(ids)) or not set(ids).issubset(owned):
            raise ValueError("Block IDs must be unique and belong to this episode")
        for block in blocks:
            if not block.get("selected_take_id"):
                block["selected_take_id"] = owned.get(block.get("id"))
            if block.get("selected_take_id"):
                take = conn.execute(
                    "SELECT status FROM generations WHERE id=? AND episode_id=? AND block_id=?",
                    (block["selected_take_id"], eid, block.get("id")),
                ).fetchone()
                if not take or take[0] != "complete":
                    raise ValueError("Select a completed take belonging to this block")
        conn.execute(
            "UPDATE episodes SET title=?,updated_at=?,revision=revision+1,gap_secs=?,sources=COALESCE(?,sources) WHERE id=?",
            (title, now, gap_secs, sources, eid),
        )
        conn.execute("DELETE FROM script_blocks WHERE episode_id=?", (eid,))
        _write_blocks(conn, eid, blocks)
    return get(eid)


def select(eid, bid, tid, revision):
    with store._connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        episode = conn.execute(
            "SELECT revision,lifecycle FROM episodes WHERE id=?", (eid,)
        ).fetchone()
        if not episode or episode[0] != revision or episode["lifecycle"] == "trashed":
            raise Conflict("Episode changed elsewhere. Reload before selecting a take.")
        take = conn.execute(
            "SELECT status FROM generations WHERE id=? AND episode_id=? AND block_id=?",
            (tid, eid, bid),
        ).fetchone()
        if not take or take[0] != "complete":
            raise ValueError("Select a completed take belonging to this block")
        changed = conn.execute(
            "UPDATE script_blocks SET selected_take_id=? WHERE id=? AND episode_id=?",
            (tid, bid, eid),
        ).rowcount
        if not changed:
            raise ValueError("Block no longer exists")
        conn.execute(
            "UPDATE episodes SET revision=revision+1,updated_at=? WHERE id=?",
            (datetime.now(UTC).isoformat(), eid),
        )
    return get(eid)


def select_first_current_take(tid, connection=None):
    """Completion may fill an empty selection, but never replace the user's choice."""
    with nullcontext(connection) if connection is not None else store._connect() as conn:
        take = conn.execute(
            "SELECT * FROM generations WHERE id=? AND status='complete'", (tid,)
        ).fetchone()
        if not take or not take["episode_id"]:
            return
        changed = conn.execute(
            "UPDATE script_blocks SET selected_take_id=? WHERE id=? AND episode_id=? AND selected_take_id IS NULL AND text=? AND voice_id=?",
            (tid, take["block_id"], take["episode_id"], take["script"], take["voice_id"]),
        ).rowcount
        if changed:
            conn.execute(
                "UPDATE episodes SET updated_at=? WHERE id=?",
                (datetime.now(UTC).isoformat(), take["episode_id"]),
            )


def selected_by(tid):
    with store._connect() as conn:
        return (
            conn.execute("SELECT 1 FROM script_blocks WHERE selected_take_id=?", (tid,)).fetchone()
            is not None
        )


def append_script(eid, revision, new_blocks, sources, limit):
    """Add generated blocks after the last one, reusing the voices already cast to each speaker."""
    episode = get(eid)
    if not episode:
        return None
    if len(episode["blocks"]) + len(new_blocks) > limit:
        raise ValueError(f"An episode can have at most {limit} blocks")
    keep = ("id", "speaker", "voice_id", "text", "selected_take_id")
    blocks = [{key: b[key] for key in keep} for b in episode["blocks"]]
    blocks += [
        {"speaker": b["speaker"], "text": b["text"], "voice_id": episode["cast"].get(b["speaker"])}
        for b in new_blocks
    ]
    merged = "\n\n".join(part for part in (episode["sources"], sources) if part.strip())
    return update(eid, episode["title"], blocks, revision, episode["gap_secs"], merged)
