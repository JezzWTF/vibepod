"""Split long script lines into sentence-sized pieces and join the rendered audio.

The model's memory use grows with the length of one generation (about 15 MiB per second of audio
on the measured 4070), so a long line is rendered as several short ones inside a single take.
"""

import re

import numpy as np

SPLIT_OVER_CHARS = 700
MAX_PIECE_CHARS = 600
PIECE_GAP_MS = 180
FADE_MS = 20
_EDGE_SILENCE = 0.002

_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie", "no", "fig", "inc",
    "ltd", "co", "mt", "approx", "dept", "est", "am", "pm",
}  # fmt: skip
_BOUNDARY = re.compile(r"""([.!?…]+["'”’)\]]*)(\s+)|([。！？]+["'”’)\]]*)""")
_CLAUSE = re.compile(r"([,;:，、；：])(\s*)")


def _ends_abbreviation(before: str) -> bool:
    word = re.search(r"(\w+)\.?$", before.rstrip("."))
    if not word:
        return False
    token = word.group(1).lower()
    return token in _ABBREVIATIONS or (len(token) == 1 and token.isalpha()) or token.isdigit()


def sentences(text: str) -> list[str]:
    """Sentences in order, keeping their punctuation. Abbreviations and initials do not end one."""
    result, start = [], 0
    for match in _BOUNDARY.finditer(text):
        end = match.end(1) if match.group(1) else match.end(3)
        if (
            match.group(1)
            and match.group(1).startswith(".")
            and _ends_abbreviation(text[start:end])
        ):
            continue
        piece = text[start:end].strip()
        if piece:
            result.append(piece)
        start = match.end()
    tail = text[start:].strip()
    if tail:
        result.append(tail)
    return result


def _shorten(sentence: str, limit: int) -> list[str]:
    """Break one over-long sentence at clauses, then at spaces."""
    if len(sentence) <= limit:
        return [sentence]
    parts, start = [], 0
    for match in _CLAUSE.finditer(sentence):
        if match.end() - start >= limit:
            parts.append(sentence[start : match.end(1)])
            start = match.end()
    parts.append(sentence[start:])
    result = []
    for part in parts:
        while len(part) > limit:
            cut = part.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            result.append(part[:cut].strip())
            part = part[cut:].strip()
        if part.strip():
            result.append(part.strip())
    return result


def split_line(text: str, over: int = SPLIT_OVER_CHARS, limit: int = MAX_PIECE_CHARS) -> list[str]:
    """One piece for a short line; otherwise pieces of at most `limit` characters."""
    text = text.strip()
    if len(text) <= over:
        return [text]
    pieces, current = [], ""
    for sentence in sentences(text):
        for part in _shorten(sentence, limit):
            joined = f"{current} {part}".strip() if current else part
            if current and len(joined) > limit:
                pieces.append(current)
                current = part
            else:
                current = joined
    if current:
        pieces.append(current)
    return pieces


def _trim(samples: np.ndarray, rate: int) -> np.ndarray:
    """Drop silence at both ends, leaving a few milliseconds so words are not clipped."""
    loud = np.flatnonzero(np.abs(samples) > _EDGE_SILENCE)
    if not loud.size:
        return samples
    keep = int(rate * 0.03)
    return samples[max(0, loud[0] - keep) : loud[-1] + 1 + keep]


def join_audio(
    pieces: list[np.ndarray], rate: int, gap_ms: int = PIECE_GAP_MS, fade_ms: int = FADE_MS
) -> np.ndarray:
    """Concatenate rendered pieces with a short pause and a fade at each join."""
    if len(pieces) == 1:
        return pieces[0]
    fade = int(rate * fade_ms / 1000)
    gap = np.zeros(int(rate * gap_ms / 1000), dtype=np.float32)
    result: list[np.ndarray] = []
    for index, piece in enumerate(pieces):
        piece = _trim(np.asarray(piece, dtype=np.float32), rate).copy()
        edge = min(fade, piece.size // 2)
        if edge:
            ramp = np.linspace(0.0, 1.0, edge, dtype=np.float32)
            if index:
                piece[:edge] *= ramp
            if index < len(pieces) - 1:
                piece[-edge:] *= ramp[::-1]
        if index:
            result.append(gap)
        result.append(piece)
    return np.concatenate(result)


def synthesize_line(adapter, text, voice, seed, cancel, progress):
    """Render a line as one take, in pieces when it is long."""
    from model_adapter import Audio, Cancelled

    pieces = split_line(text)
    if len(pieces) == 1:
        return adapter.synthesize(text, voice, {"seed": seed}, cancel, progress)
    rendered, rate, done_steps = [], None, 0
    for index, piece in enumerate(pieces):
        if cancel is not None and cancel.is_set():
            raise Cancelled()
        last = {"steps": 0}

        def report(stage, steps=None, base=done_steps, last=last):
            if progress:
                if steps is not None:
                    last["steps"] = steps
                progress(stage, None if steps is None else base + steps)

        audio = adapter.synthesize(piece, voice, {"seed": seed + index}, cancel, report)
        rendered.append(audio.samples)
        rate = audio.sample_rate
        done_steps += last["steps"]
    return Audio(join_audio(rendered, rate), rate)
