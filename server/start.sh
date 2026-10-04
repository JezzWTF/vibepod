#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ "$#" -ne 0 ]; then echo "CUDA only; no device flags are supported." >&2; exit 2; fi
export UV_PROJECT_ENVIRONMENT="${VIBEPOD_VENV:-.venv}"
uv sync --frozen
exec uv run --no-sync uvicorn tts_server:app --host 127.0.0.1 --port "${VIBEPOD_PORT:-8000}"
