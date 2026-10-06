"""Public checkpoint fallback: bounded HTTPS ranges and verified LFS hashes."""

import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path

import requests
from huggingface_hub import HfApi


def sha256(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("repo")
parser.add_argument("destination", type=Path)
parser.add_argument("--revision", help="Exact checkpoint revision to verify and download")
parser.add_argument("--progress-json", action="store_true", help="Emit structured desktop progress")
parser.add_argument(
    "--cache", type=Path, help="Reuse completed or partial files from this spike's Hub cache"
)
args = parser.parse_args()
info = HfApi(token=False).model_info(args.repo, revision=args.revision, files_metadata=True)
entries = [
    e for e in info.siblings if e.rfilename.endswith((".json", ".txt", ".safetensors", ".model"))
]
total_bytes = sum(e.size or 0 for e in entries)
completed_bytes = 0
last_progress = 0.0


def progress(file, phase, offset=0):
    global last_progress
    if args.progress_json:
        now = time.monotonic()
        if phase == "downloading" and now - last_progress < 0.25:
            return
        last_progress = now
        print(
            json.dumps(
                {
                    "event": "model_progress",
                    "file": file,
                    "phase": phase,
                    "downloaded": completed_bytes + offset,
                    "total": total_bytes,
                }
            ),
            flush=True,
        )


args.destination.mkdir(parents=True, exist_ok=True)
remaining = 0
for entry in entries:
    candidate = args.destination / entry.rfilename
    if not candidate.resolve().is_relative_to(args.destination.resolve()):
        raise ValueError("Model file path escapes the destination")
    partial = candidate.with_name(candidate.name + ".partial")
    existing = candidate.stat().st_size if candidate.exists() else 0
    resumed = partial.stat().st_size if partial.exists() else 0
    # A complete file still gets its hash checked below. Corrupt complete files
    # need a replacement alongside the original until verification succeeds.
    valid = (
        candidate.exists()
        and existing == entry.size
        and (not entry.lfs or sha256(candidate) == entry.lfs.sha256)
    )
    if not valid:
        remaining += max(0, (entry.size or 0) - resumed)
if shutil.disk_usage(args.destination).free < remaining + 256 * 2**20:
    raise RuntimeError(f"Not enough free space for this model: {remaining / 2**30:.1f} GB required")
for entry in entries:
    target = args.destination / entry.rfilename
    if not target.resolve().is_relative_to(args.destination.resolve()):
        raise ValueError("Model file path escapes the destination")
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = entry.lfs.sha256 if entry.lfs else None
    progress(entry.rfilename, "verifying")
    if (
        target.exists()
        and target.stat().st_size == entry.size
        and (not digest or sha256(target) == digest)
    ):
        print(f"Already verified {entry.rfilename}", flush=True)
        completed_bytes += entry.size
        progress(entry.rfilename, "verified")
        continue
    partial = target.with_name(target.name + ".partial")
    if args.cache and not partial.exists() and digest:
        blob = args.cache / ("models--" + args.repo.replace("/", "--")) / "blobs" / digest
        if not blob.exists():
            blob = blob.with_name(blob.name + ".incomplete")
        if blob.exists():
            # These are task-owned files on the same volume; move, preserving bytes.
            blob.replace(partial)
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > entry.size:
        raise ValueError(f"Partial file is too large: {entry.rfilename}")
    url = f"https://huggingface.co/{args.repo}/resolve/{info.sha}/{entry.rfilename}"
    while offset < entry.size:
        end = min(offset + 64 * 2**20, entry.size) - 1
        with requests.get(
            url,
            headers={"Range": f"bytes={offset}-{end}", "Accept-Encoding": "identity"},
            timeout=(15, 30),
            stream=True,
        ) as response:
            response.raise_for_status()
            expected_range = f"bytes {offset}-{end}/{entry.size}"
            valid_range = (
                response.status_code == 206
                and response.headers.get("Content-Range") == expected_range
            )
            whole_small_file = (
                offset == 0 and response.status_code == 200 and entry.size <= 64 * 2**20
            )
            if not (valid_range or whole_small_file):
                raise RuntimeError(f"Server did not honour requested range for {entry.rfilename}")
            received = 0
            with partial.open("ab") as handle:
                for chunk in response.iter_content(2**20):
                    if received + len(chunk) > end - offset + 1:
                        raise RuntimeError("Response exceeded requested range")
                    handle.write(chunk)
                    received += len(chunk)
                    progress(entry.rfilename, "downloading", offset + received)
            if received != end - offset + 1:
                raise RuntimeError(f"Incomplete response for {entry.rfilename}")
        offset += received
        print(f"{entry.rfilename}: {offset}/{entry.size}", flush=True)
    if digest:
        progress(entry.rfilename, "verifying", offset)
        actual = sha256(partial)
        if actual != digest:
            partial.unlink()
            raise RuntimeError(f"SHA256 mismatch for {entry.rfilename}")
    partial.replace(target)
    completed_bytes += entry.size
    progress(entry.rfilename, "verified")
(args.destination / "spike-source.json").write_text(
    json.dumps(
        {
            "repo": args.repo,
            "revision": info.sha,
            # Sizes of the files verified above, so a later launch can spot a missing or
            # truncated file without hashing gigabytes again.
            "files": {e.rfilename: e.size for e in entries if e.size},
        },
        indent=2,
    ),
    encoding="utf-8",
)
print(f"Verified checkpoint: {args.destination}", flush=True)
progress("", "complete")
