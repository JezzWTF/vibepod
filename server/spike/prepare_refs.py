"""Trim upstream demo samples without changing their native sample rates."""

import argparse
import hashlib
import json
from pathlib import Path

import soundfile as sf

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path, help="VibeVoice community demo/voices directory")
parser.add_argument("output", type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
sources = {1: "en-Alice_woman.wav", 2: "en-Frank_man.wav"}
manifest = {}
for speaker, name in sources.items():
    audio, rate = sf.read(args.source / name, dtype="float32")
    if audio.ndim != 1:
        raise ValueError(f"Expected mono reference: {name}")
    target = args.output / f"speaker-{speaker}.wav"
    sf.write(target, audio[: 3 * rate], rate, subtype="PCM_16")
    manifest[name] = {
        "sample_rate": rate,
        "seconds": min(3, len(audio) / rate),
        "source_sha256": hashlib.sha256((args.source / name).read_bytes()).hexdigest(),
        "reference_sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }
(args.output / "sources.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps(manifest, indent=2))
