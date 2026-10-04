"""Reusable reference voices, independent of the model implementation."""

import json
import uuid

import numpy as np
import soundfile as sf

from generation_store import DATA_DIR

ROOT = DATA_DIR / "voices"


def list_voices():
    ROOT.mkdir(parents=True, exist_ok=True)
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(ROOT.glob("*/voice.json"))]


def get_voice(voice_id):
    return next((v for v in list_voices() if v["id"] == voice_id), None)


def save_voice(name, samples, rate, transcript="", kind="clone", description=""):
    name = name.strip()
    if not name:
        raise ValueError("Enter a voice name")
    samples = np.asarray(samples, dtype=np.float32)
    if samples.ndim == 2:
        samples = samples.mean(axis=1)
    if samples.ndim != 1 or not np.isfinite(samples).all() or not 8000 <= rate <= 192000:
        raise ValueError("Upload a valid WAV reference.")
    if not 3 <= len(samples) / rate <= 30 or np.max(np.abs(samples)) < 0.001:
        raise ValueError("Reference must contain 3–30 seconds of audible speech.")
    voice_id = "voice_" + uuid.uuid4().hex
    directory = ROOT / voice_id
    directory.mkdir(parents=True)
    reference = directory / "reference.wav"
    sf.write(reference, samples, rate, subtype="PCM_16")
    voice = dict(
        id=voice_id,
        name=name,
        kind=kind,
        transcript=transcript,
        description=description,
        language="English",
        reference=str(reference),
    )
    metadata = directory / "voice.tmp"
    metadata.write_text(json.dumps(voice), encoding="utf-8")
    metadata.replace(directory / "voice.json")
    return voice
