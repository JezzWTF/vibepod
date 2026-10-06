"""Stream selected takes into a cached WAV without retaining the episode in RAM."""

import hashlib
import json
import threading

import numpy as np
import soundfile as sf

import generation_store as store

_lock = threading.Lock()


def assemble(episode, *, allow_partial=False):
    selected = []
    segments = []
    cursor = 0
    for block in episode["blocks"]:
        take = next(
            (
                t
                for t in block["takes"]
                if t["id"] == block["selected_take_id"] and t["status"] == "complete"
            ),
            None,
        )
        if not take:
            if allow_partial:
                continue
            raise ValueError("Every block needs a selected completed take before episode playback")
        selected.append(take)
        segments.append(
            {"block_id": block["id"], "start_secs": cursor, "duration_secs": take["duration_secs"]}
        )
        cursor += take["duration_secs"] + episode["gap_secs"]
    if not selected:
        raise ValueError("Select at least one completed take before previewing")
    fingerprint = hashlib.sha256(
        json.dumps([episode["gap_secs"], [t["id"] for t in selected]]).encode()
    ).hexdigest()[:24]
    directory = store.DB_PATH.parent.parent / "episode-audio" / episode["id"]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{fingerprint}.wav"
    with _lock:
        if not path.exists():
            rate = selected[0]["sample_rate"]
            if any(t["sample_rate"] != rate for t in selected):
                raise ValueError("Selected takes have incompatible sample rates")
            temporary = path.with_suffix(".tmp.wav")
            try:
                with sf.SoundFile(
                    temporary, "w", samplerate=rate, channels=1, subtype="PCM_16"
                ) as output:
                    for index, take in enumerate(selected):
                        if index:
                            output.write(
                                np.zeros(round(rate * episode["gap_secs"]), dtype=np.float32)
                            )
                        with sf.SoundFile(take["audio_path"]) as source:
                            for chunk in source.blocks(
                                blocksize=65536, dtype="float32", always_2d=True
                            ):
                                output.write(chunk.mean(axis=1))
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
    return path, segments
