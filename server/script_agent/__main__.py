"""python -m script_agent "topic" [--provider claude|codex|ollama] [--minutes 10] ..."""

import argparse
import json
import sys
import urllib.request
import uuid
from pathlib import Path

from generation_store import DATA_DIR

from .pipeline import Pipeline, PipelineError
from .prompts import Brief
from .providers import ProviderError, make_provider


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="script_agent")
    ap.add_argument("topic")
    ap.add_argument("--provider", choices=["claude", "codex", "ollama"], default="claude")
    ap.add_argument("--model")
    ap.add_argument("--minutes", type=int, default=10)
    ap.add_argument("--speakers", default="Alice,Frank")
    ap.add_argument("--tone", default=Brief.tone)
    ap.add_argument("--angle", default="")
    ap.add_argument("--notes-file", help="Facts to use; required for providers that cannot search")
    ap.add_argument("--no-research", action="store_true")
    ap.add_argument("--review", action="store_true", help="Extra accuracy pass per section")
    ap.add_argument("--run", help="Resume an existing run id")
    ap.add_argument("--import-to", metavar="URL", help="Create an episode on this server")
    args = ap.parse_args(argv)

    brief = Brief(
        topic=args.topic,
        minutes=args.minutes,
        speakers=tuple(s.strip() for s in args.speakers.split(",") if s.strip()),
        tone=args.tone,
        angle=args.angle,
        notes=Path(args.notes_file).read_text(encoding="utf-8") if args.notes_file else "",
    )
    run_id = args.run or f"run_{uuid.uuid4().hex[:10]}"
    run_dir = DATA_DIR / "script_runs" / run_id
    try:
        pipeline = Pipeline(
            make_provider(args.provider, args.model),
            brief,
            run_dir,
            review=args.review,
            research=not args.no_research,
            progress=lambda stage, i, n: print(f"{stage} {i}/{n}", file=sys.stderr),
        )
        title, blocks = pipeline.run()
    except (ProviderError, PipelineError) as exc:
        print(f"Failed: {exc}\nResume with --run {run_id}", file=sys.stderr)
        return 1
    print(f"{title}: {len(blocks)} blocks -> {run_dir / 'script.txt'}", file=sys.stderr)
    if args.import_to:
        body = {
            "title": title,
            "blocks": [{"speaker": b.speaker, "text": b.text} for b in blocks],
        }
        request = urllib.request.Request(
            f"{args.import_to.rstrip('/')}/episodes",
            json.dumps(body).encode(),
            {"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request) as response:
            print(json.load(response)["id"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
