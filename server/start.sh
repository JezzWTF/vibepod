#!/usr/bin/env bash
# VibePod TTS server — start script
# Syncs the uv environment, downloads the model on first run, then launches uvicorn.
# Prerequisite: uv must be installed (https://docs.astral.sh/uv/getting-started/installation/)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  VibePod TTS Server"
echo "================================================"

# 1. Check uv is available
if ! command -v uv &>/dev/null; then
    echo ""
    echo "ERROR: uv is not installed."
    echo "Install it first:"
    echo "  Windows:    winget install astral-sh.uv"
    echo "  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo ""
    exit 1
fi

# 2. Sync Python environment (creates .venv on first run, no-op afterwards)
echo ""
echo "--> Syncing Python environment..."
uv sync

# 3. Start the server — model download + load happens inside the server process
#    so the /health endpoint is reachable immediately and can report progress.
echo ""
echo "--> Starting uvicorn on http://0.0.0.0:8000"
export PYTHONUTF8=1
exec uv run uvicorn vibevoice_server:app \
    --host 0.0.0.0 \
    --port 8000 \
    --log-level info \
    "$@"
