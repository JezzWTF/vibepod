"""Prefetch the Base checkpoint with the resumable spike downloader."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).parent / "spike" / "download.py"), run_name="__main__")
