"""Public checkpoint fallback: bounded HTTPS ranges and verified LFS hashes."""

import argparse
import hashlib
import json
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
parser.add_argument(
    "--cache", type=Path, help="Reuse completed or partial files from this spike's Hub cache"
)
args = parser.parse_args()
info = HfApi(token=False).model_info(args.repo, revision=args.revision, files_metadata=True)
args.destination.mkdir(parents=True, exist_ok=True)
for entry in info.siblings:
    if not entry.rfilename.endswith((".json", ".txt", ".safetensors", ".model")):
        continue
    target = args.destination / entry.rfilename
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = entry.lfs.sha256 if entry.lfs else None
    if (
        target.exists()
        and target.stat().st_size == entry.size
        and (not digest or sha256(target) == digest)
    ):
        print(f"Already verified {entry.rfilename}", flush=True)
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
            if received != end - offset + 1:
                raise RuntimeError(f"Incomplete response for {entry.rfilename}")
        offset += received
        print(f"{entry.rfilename}: {offset}/{entry.size}", flush=True)
    if digest:
        actual = sha256(partial)
        if actual != digest:
            raise RuntimeError(f"SHA256 mismatch for {entry.rfilename}")
    partial.replace(target)
(args.destination / "spike-source.json").write_text(
    json.dumps({"repo": args.repo, "revision": info.sha}, indent=2), encoding="utf-8"
)
print(f"Verified checkpoint: {args.destination}", flush=True)
