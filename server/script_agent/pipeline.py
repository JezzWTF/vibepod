"""Resumable research -> outline -> draft -> review pipeline.

Every stage writes its result into the run directory before the next one starts, so an interrupted
run (usage limit, cancellation, closed window) resumes where it stopped.
"""

import json
import threading
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from . import prompts
from .formatting import Block, parse, render
from .prompts import Brief
from .providers import Cancelled, Provider, ProviderError

Progress = Callable[[str, int, int], None]


class PipelineError(RuntimeError):
    pass


class Pipeline:
    def __init__(
        self,
        provider: Provider,
        brief: Brief,
        run_dir: Path,
        *,
        review: bool = False,
        research: bool = True,
        cancel: threading.Event | None = None,
        progress: Progress | None = None,
        timeout: float = 900,
    ):
        self.provider, self.brief, self.dir = provider, brief, Path(run_dir)
        self.review, self.research = review, research
        self.cancel, self.progress, self.timeout = cancel, progress or (lambda *_: None), timeout
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "brief.json").write_text(json.dumps(asdict(brief), indent=2), encoding="utf-8")

    def _ask(self, prompt: str, *, web: bool = False) -> str:
        if self.cancel and self.cancel.is_set():
            raise Cancelled("Cancelled")
        return self.provider.run(
            prompt, web=web and self.provider.supports_web, timeout=self.timeout, cancel=self.cancel
        )

    def _cached(self, name: str, make: Callable[[], str]) -> str:
        path = self.dir / name
        if path.exists():
            return path.read_text(encoding="utf-8")
        text = make().strip()
        if not text:
            raise PipelineError(f"The model returned nothing for {name}")
        path.write_text(text, encoding="utf-8")
        return text

    def _blocks(self, text: str, what: str) -> list[Block]:
        blocks, problems = parse(text, list(self.brief.speakers))
        if problems:
            fixed = self._ask(prompts.repair(text, problems, self.brief.speakers))
            blocks, problems = parse(fixed, list(self.brief.speakers))
        if problems or not blocks:
            raise PipelineError(f"{what} is not usable: {'; '.join(problems[:3])}")
        return blocks

    def notes(self) -> str:
        if not self.research:
            return self.brief.notes
        if not self.provider.supports_web:
            if not self.brief.notes:
                raise PipelineError(
                    f"{self.provider.name} cannot search the web. Add notes or choose another provider."
                )
            return self.brief.notes
        self.progress("Researching", 0, 1)
        return self._cached(
            "research.md", lambda: self._ask(prompts.research(self.brief), web=True)
        )

    def outline(self, notes: str) -> dict:
        self.progress("Outlining", 0, 1)
        raw = self._cached("outline.json", lambda: self._ask(prompts.outline(self.brief, notes)))
        try:
            return prompts.parse_outline(raw)
        except (ValueError, json.JSONDecodeError) as exc:
            (self.dir / "outline.json").unlink(missing_ok=True)
            raise PipelineError(f"Could not read the outline: {exc}") from exc

    def run(self) -> tuple[str, list[Block]]:
        notes = self.notes()
        plan = self.outline(notes)
        sections = plan["sections"]
        blocks: list[Block] = []
        for index, item in enumerate(sections):
            self.progress("Drafting", index, len(sections))
            tail = render(blocks[-4:])

            def draft(item=item, index=index, tail=tail) -> str:
                raw = self._ask(
                    prompts.section(
                        self.brief, plan["title"], item, index, len(sections), notes, tail
                    )
                )
                drafted = self._blocks(raw, f"Section {index + 1}")
                budget = item["blocks"] * prompts.WORDS_PER_BLOCK
                if sum(len(b.text.split()) for b in drafted) > budget * 1.5:
                    raw = self._ask(prompts.condense(render(drafted), budget))
                    drafted = self._blocks(raw, f"Section {index + 1}")
                return render(drafted)

            text = self._cached(f"section_{index + 1:02d}.txt", draft)
            if self.review:
                self.progress("Reviewing", index, len(sections))

                def revise(text=text, index=index) -> str:
                    raw = self._ask(prompts.review(self.brief, text, notes))
                    return render(self._blocks(raw, f"Review of section {index + 1}"))

                text = self._cached(f"section_{index + 1:02d}.reviewed.txt", revise)
            blocks.extend(self._blocks(text, f"Section {index + 1}"))
        script = render(blocks)
        (self.dir / "script.txt").write_text(script, encoding="utf-8")
        self.progress("Done", len(sections), len(sections))
        return plan["title"], blocks


__all__ = ["Pipeline", "PipelineError", "ProviderError"]
