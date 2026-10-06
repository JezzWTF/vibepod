"""Parse and validate model output as `Speaker: line` script blocks."""

import re
from dataclasses import dataclass

MAX_BLOCK_CHARS = 700
_LINE = re.compile(r"^\s*\**\[?(\w[\w .'-]{0,38}?)\]?\**\s*:\s*(.+)$")
_FENCE = re.compile(r"^```\w*\s*$")


@dataclass(frozen=True)
class Block:
    speaker: str
    text: str


def clean_text(text: str) -> str:
    """Strip markup and directions that a voice would read aloud."""
    text = re.sub(
        r"\(([^)]*)\)|\[[^\]]*\]", lambda m: "" if _is_direction(m.group(0)) else m.group(0), text
    )
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[*_`#>]+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _is_direction(group: str) -> bool:
    inner = group[1:-1].strip().lower()
    return (
        inner.split(" ")[0]
        in {
            "laughs",
            "laughing",
            "pause",
            "sighs",
            "chuckles",
            "music",
            "sfx",
            "beat",
            "smiles",
            "intro",
            "outro",
        }
        or len(inner.split()) <= 3
        and group.startswith("[")
    )


def parse(text: str, speakers: list[str]) -> tuple[list[Block], list[str]]:
    """Return the blocks and a list of human-readable problems (empty when clean)."""
    allowed = {s.lower(): s for s in speakers}
    blocks: list[Block] = []
    problems: list[str] = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or _FENCE.match(line) or set(line) <= set("-=*_ "):
            continue
        match = _LINE.match(line)
        if not match:
            problems.append(f"Line {number} is not `Speaker: line`: {line[:60]!r}")
            continue
        name = allowed.get(match.group(1).strip().lower())
        if not name:
            problems.append(f"Line {number} uses unknown speaker {match.group(1).strip()!r}")
            continue
        spoken = clean_text(match.group(2))
        if not spoken:
            continue
        if len(spoken) > MAX_BLOCK_CHARS:
            problems.append(
                f"Line {number} is {len(spoken)} characters; split it (max {MAX_BLOCK_CHARS})"
            )
            continue
        blocks.append(Block(name, spoken))
    if not blocks and not problems:
        problems.append("No script lines were found")
    return blocks, problems


def render(blocks: list[Block]) -> str:
    return "\n".join(f"{b.speaker}: {b.text}" for b in blocks)
