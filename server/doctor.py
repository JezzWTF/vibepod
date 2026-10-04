"""Explicit setup checks; startup never installs or upgrades dependencies."""

import shutil
import subprocess
import sys


def main():
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError("Use the locked Python 3.12 environment")
    from model_adapter import runtime_info

    info = runtime_info()
    print(f"[check] {info['name']}: {info['vram_gb']:.1f} GB VRAM")
    print(f"[check] Python {sys.version.split()[0]}, torch {info['torch']}, CUDA {info['cuda']}")
    if info["vram_gb"] < 11:
        raise RuntimeError("Supported target: NVIDIA GPU with at least 12 GB VRAM")
    for name in ("ffmpeg", "ffprobe"):
        if not shutil.which(name):
            raise RuntimeError(
                f"{name} is missing from PATH. Install FFmpeg and reopen the terminal."
            )
        subprocess.run([name, "-version"], check=True, stdout=subprocess.DEVNULL)
    print("[check] FFmpeg and ffprobe available")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[check] {exc}", file=sys.stderr)
        sys.exit(1)
