"""Prompt templates. Each stage states its exact output format so replies can be parsed."""

import json
from dataclasses import dataclass

WORDS_PER_MINUTE = 150
WORDS_PER_BLOCK = 40


@dataclass(frozen=True)
class Brief:
    topic: str
    minutes: int = 10
    speakers: tuple[str, ...] = ("Alice", "Frank")
    tone: str = "warm, curious and conversational"
    angle: str = ""
    notes: str = ""

    @property
    def words(self) -> int:
        return self.minutes * WORDS_PER_MINUTE

    @property
    def blocks(self) -> int:
        return max(4, self.words // WORDS_PER_BLOCK)

    @property
    def sections(self) -> tuple[int, int]:
        middle = max(1, round(self.minutes / 2.5))
        return max(1, middle - 1), middle + 1


def research(brief: Brief) -> str:
    return f"""You are the researcher for a podcast episode about: {brief.topic}
{f"Angle: {brief.angle}" if brief.angle else ""}
{f"The host already has these notes:{chr(10)}{brief.notes}" if brief.notes else ""}

Search the web and gather accurate, current, interesting material for a {brief.minutes}-minute conversation.
Prefer primary and reputable sources. Output Markdown notes only: 12-25 bullet points of concrete facts,
figures, examples, disagreements and good stories. End every bullet with its source URL in parentheses.
Do not write the script. Do not include any preamble."""


def outline(brief: Brief, notes: str) -> str:
    return f"""Plan a {brief.minutes}-minute two-person podcast conversation about: {brief.topic}
Speakers: {", ".join(brief.speakers)}. Tone: {brief.tone}. {f"Angle: {brief.angle}." if brief.angle else ""}

Research notes:
{notes or "(none, use well-established knowledge only and avoid specific claims you cannot stand behind)"}

Reply with JSON only, no commentary, in exactly this shape:
{{"title": "episode title", "sections": [{{"heading": "short heading", "summary": "what this section covers and which notes it uses", "blocks": 10}}]}}
Use {brief.sections[0]}-{brief.sections[1]} sections. The whole episode is about {brief.words} words, so the "blocks" values (one block is one spoken turn of about {WORDS_PER_BLOCK} words) must add up to about {brief.blocks}. Open with a hook and close with a clear takeaway."""


def section(
    brief: Brief, title: str, plan: dict, index: int, total: int, notes: str, tail: str
) -> str:
    words = plan["blocks"] * WORDS_PER_BLOCK
    return f"""You are writing section {index + 1} of {total} of the podcast "{title}", a conversation between {" and ".join(brief.speakers)}.
Tone: {brief.tone}.

Section: {plan["heading"]} - {plan["summary"]}
Length: about {words} words in total across all lines (roughly {plan["blocks"]} turns). Never exceed {int(words * 1.25)} words.

Research notes (the only source of specific facts; do not invent statistics, quotes or sources):
{notes or "(none)"}

{f"The conversation so far ended with:{chr(10)}{tail}{chr(10)}Continue naturally from there without repeating it." if tail else "This is the opening of the episode."}

Output rules, which are strict because every line is read aloud by a voice model:
- Every line is exactly `Speaker: spoken text` using only these names: {", ".join(brief.speakers)}.
- One speaker turn per line, 1-3 sentences, under 60 words. No blank-line paragraphs.
- No markdown, bullet points, headings, stage directions, sound cues, emojis or URLs.
- Write numbers, units and acronyms the way they are spoken. Do not cite sources aloud as links.
- Output the script lines only. No commentary before or after."""


def condense(text: str, words: int) -> str:
    return f"""This script section is too long. Condense it to about {words} words (hard maximum {int(words * 1.25)}),
keeping the strongest points, the same speakers and the exact `Speaker: spoken text` one-line format.
Output the script lines only.

{text}"""


def review(brief: Brief, text: str, notes: str) -> str:
    return f"""Review this podcast script section for accuracy against the notes, repetition, and how natural it sounds when spoken.
Fix problems by editing in place. Keep the same speakers and the same `Speaker: spoken text` one-line format,
with no markdown, directions or commentary. Keep roughly the same length.

Research notes:
{notes or "(none)"}

Script section:
{text}

Output the corrected script lines only."""


def repair(text: str, problems: list[str], speakers: tuple[str, ...]) -> str:
    return f"""Your previous reply did not follow the required format.
Problems:
{chr(10).join(f"- {p}" for p in problems[:12])}

Rewrite it so that every line is exactly `Speaker: spoken text` using only these names: {", ".join(speakers)}.
Split any line over 60 words. Output the script lines only.

Previous reply:
{text}"""


def parse_outline(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("The outline reply contained no JSON")
    data = json.loads(text[start : end + 1])
    sections = data.get("sections")
    if not isinstance(sections, list) or not sections:
        raise ValueError("The outline had no sections")
    for item in sections:
        item["blocks"] = max(2, int(item.get("blocks", 8)))
        item.setdefault("summary", "")
        if not item.get("heading"):
            raise ValueError("A section is missing its heading")
    data.setdefault("title", "Untitled episode")
    return data
