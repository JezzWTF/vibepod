#!/usr/bin/env python3
"""
Download microsoft/VibeVoice-Realtime-0.5B to the local HuggingFace cache.

Run once before starting the server:
    python download_model.py

Set HF_HOME or HUGGINGFACE_HUB_CACHE to control where the model is stored.
Set HF_TOKEN (or HUGGINGFACE_TOKEN) if you need an access token.
"""

import os
import sys
import time

MODEL_ID = "microsoft/VibeVoice-Realtime-0.5B"

# Patterns that are not needed for PyTorch inference
_IGNORE = [
    "*.msgpack",
    "flax_model*",
    "tf_model*",
    "rust_model*",
    "*.ot",
]


def download() -> str:
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print(
            "ERROR: huggingface_hub is not installed.\n"
            "Run: pip install huggingface_hub",
            file=sys.stderr,
        )
        sys.exit(1)

    token: str | None = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

    print(f"Checking / downloading model: {MODEL_ID}")
    print("(This may take several minutes on first run — the model is ~1 GB)")
    start = time.time()

    cache_path = snapshot_download(
        repo_id=MODEL_ID,
        ignore_patterns=_IGNORE,
        token=token or None,
    )

    elapsed = time.time() - start
    print(f"Model ready in {elapsed:.1f}s → {cache_path}")
    return cache_path


if __name__ == "__main__":
    download()
