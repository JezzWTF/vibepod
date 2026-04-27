#!/usr/bin/env bash
# VibePod TTS server startup script
# Usage: ./start.sh [uvicorn options]
#
# Downloads the model on first run, then starts the FastAPI server.
# Set HF_TOKEN env var if a HuggingFace access token is required.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================"
echo "  VibePod TTS Server"
echo "================================================"

# 1. Ensure Python deps are available
if ! python -c "import fastapi" &>/dev/null; then
  echo "Installing Python dependencies..."
  pip install -r requirements.txt
fi

# 2. Download model if not already cached
echo ""
echo "--> Checking model cache..."
python download_model.py

# 3. Start the server
echo ""
echo "--> Starting uvicorn on http://0.0.0.0:8000"
exec uvicorn vibevoice_server:app \
  --host 0.0.0.0 \
  --port 8000 \
  --log-level info \
  "$@"
