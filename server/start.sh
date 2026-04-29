#!/usr/bin/env bash
# VibePod TTS server — start script
# Syncs the uv environment, downloads the model on first run, then launches uvicorn.
# Prerequisite: uv must be installed (https://docs.astral.sh/uv/getting-started/installation/)
#
# Usage:
#   ./start.sh          — CUDA mode (default, uses PyTorch CUDA 12.4 wheel, venv: .venv)
#   ./start.sh --cpu    — CPU-only mode (uses PyPI CPU torch wheel, venv: .venv-cpu)
#
# The two modes maintain completely separate virtual environments so their torch
# installations never conflict. UV_PROJECT_ENVIRONMENT tells uv which venv to use;
# --no-sources skips [tool.uv.sources] so the CPU run pulls the default PyPI torch wheel.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
CPU_MODE=false
PASSTHROUGH_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --cpu) CPU_MODE=true ;;
        *)     PASSTHROUGH_ARGS+=("$arg") ;;
    esac
done

echo "================================================"
echo "  VibePod TTS Server"
if $CPU_MODE; then
    echo "  Mode : CPU-only"
else
    echo "  Mode : CUDA (default)"
fi
echo "================================================"

# ---------------------------------------------------------------------------
# 1. Check uv is available
# ---------------------------------------------------------------------------
if ! command -v uv &>/dev/null; then
    echo ""
    echo "ERROR: uv is not installed."
    echo "Install it first:"
    echo "  Windows:    winget install astral-sh.uv"
    echo "  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Sync Python environment
#    CPU mode:  use .venv-cpu and skip [tool.uv.sources] so uv pulls the
#               default PyPI (CPU-only) torch wheel instead of the CUDA one.
#    CUDA mode: standard uv sync — uses .venv and respects [tool.uv.sources].
# ---------------------------------------------------------------------------
echo ""
if $CPU_MODE; then
    echo "--> Syncing CPU Python environment (.venv-cpu)..."
    export UV_PROJECT_ENVIRONMENT=".venv-cpu"
    uv sync --no-sources
else
    echo "--> Syncing CUDA Python environment (.venv)..."
    uv sync
fi

# ---------------------------------------------------------------------------
# 3. Launch uvicorn
#    Pass DEVICE env var so the server can select the correct torch device.
# ---------------------------------------------------------------------------
echo ""
echo "--> Starting uvicorn on http://127.0.0.1:8000"
export PYTHONUTF8=1

if $CPU_MODE; then
    export VIBEPOD_DEVICE="cpu"
    export UV_PROJECT_ENVIRONMENT=".venv-cpu"
else
    export VIBEPOD_DEVICE="cuda"
fi

exec uv run uvicorn vibevoice_server:app \
    --host 127.0.0.1 \
    --port 8000 \
    --log-level info \
    "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}"
