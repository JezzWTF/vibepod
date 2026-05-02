"""Waveform peak generation for VibePod.

Reads a WAV file and produces min/max peak arrays suitable for canvas rendering.
The output format matches the WaveformPeaks TypeScript type in the frontend.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf


def compute_peaks(
    audio_path: str | Path,
    samples_per_pixel: int = 256,
) -> dict:
    """Compute min/max waveform peaks from a WAV file.

    Args:
        audio_path: Path to a WAV file (any bit depth, any channel count).
        samples_per_pixel: How many audio samples are condensed into one peak pair.
                           256 is a good default for a ~1000px wide waveform at
                           standard podcast lengths.

    Returns:
        A dict matching the WaveformPeaks TypeScript type:
        {
            "sampleRate": int,
            "durationSecs": float,
            "channels": int,
            "samplesPerPixel": int,
            "length": int,           # number of peak pairs
            "data": {
                "min": [float, ...], # values in [-1.0, 0.0]
                "max": [float, ...], # values in [0.0, 1.0]
            }
        }
    """
    samples, sample_rate = sf.read(str(audio_path), dtype="float32", always_2d=True)

    # Mix to mono by averaging channels
    mono = samples.mean(axis=1)
    total_samples = len(mono)
    duration_secs = total_samples / sample_rate
    channels = samples.shape[1]

    # Pad so total_samples is divisible by samples_per_pixel
    remainder = total_samples % samples_per_pixel
    if remainder:
        pad = samples_per_pixel - remainder
        mono = np.concatenate([mono, np.zeros(pad, dtype=np.float32)])

    frames = mono.reshape(-1, samples_per_pixel)
    peak_min = frames.min(axis=1).tolist()
    peak_max = frames.max(axis=1).tolist()
    length = len(peak_min)

    return {
        "sampleRate": int(sample_rate),
        "durationSecs": round(duration_secs, 4),
        "channels": int(channels),
        "samplesPerPixel": samples_per_pixel,
        "length": length,
        "data": {
            "min": [round(float(v), 5) for v in peak_min],
            "max": [round(float(v), 5) for v in peak_max],
        },
    }


def write_peaks(audio_path: str | Path, output_path: str | Path, samples_per_pixel: int = 256) -> None:
    """Compute peaks and write them to a JSON file."""
    peaks = compute_peaks(audio_path, samples_per_pixel)
    Path(output_path).write_text(json.dumps(peaks, separators=(",", ":")), encoding="utf-8")
