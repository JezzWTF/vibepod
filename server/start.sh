#!/usr/bin/env bash
# VibePod TTS server — start script
# Syncs the uv environment, downloads the model on first run, then launches uvicorn.
# Prerequisite: uv must be installed (https://docs.astral.sh/uv/getting-started/installation/)
#
# Usage:
#   ./start.sh          — CUDA mode (default, uses PyTorch CUDA 12.4 wheel, venv: .venv)
#   ./start.sh --cpu    — CPU-only mode (uses PyPI CPU torch wheel, venv: .venv-cpu)
#
# Optional CUDA acceleration:
#   VIBEPOD_ENABLE_FLASH_ATTN=1 ./start.sh
#   Installs a matching third-party Windows flash-attn wheel when the CUDA venv
#   uses Python 3.12, torch 2.6.0, and CUDA 12.4.
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

validate_flash_attn() {
    uv run python -c "import flash_attn; import triton; import transformers.modeling_utils" &>/dev/null
}

remove_broken_flash_attn() {
    if uv run python -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('flash_attn') else 1)" &>/dev/null; then
        if ! validate_flash_attn; then
            echo "    Installed flash-attn is not usable in this environment; removing it."
            uv pip uninstall flash-attn
        fi
    fi
}

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
    LOCK_BACKUP=""
    if [[ -f uv.lock ]]; then
        LOCK_BACKUP="$(mktemp)"
        cp uv.lock "$LOCK_BACKUP"
    fi
    uv sync --no-sources
    if [[ -n "$LOCK_BACKUP" ]]; then
        cp "$LOCK_BACKUP" uv.lock
        rm -f "$LOCK_BACKUP"
    fi
else
    echo "--> Syncing CUDA Python environment (.venv)..."
    uv sync

    remove_broken_flash_attn

    if [[ "${VIBEPOD_ENABLE_FLASH_ATTN:-0}" == "1" ]]; then
        echo ""
        echo "--> Checking optional FlashAttention wheel..."

        if validate_flash_attn; then
            echo "    flash-attn already installed and importable."
        else
            PY_TAG="$(uv run python -c "import sys; print(f'cp{sys.version_info.major}{sys.version_info.minor}')")"
            TORCH_TAG="$(uv run python -c "import torch; print(torch.__version__.split('+', 1)[0])")"
            CUDA_TAG="$(uv run python -c "import torch; print('cu' + torch.version.cuda.replace('.', ''))")"

            if [[ "$PY_TAG" == "cp312" && "$TORCH_TAG" == "2.6.0" && "$CUDA_TAG" == "cu124" ]]; then
                FLASH_ATTN_WHEEL_URL="https://huggingface.co/lldacing/flash-attention-windows-wheel/resolve/main/flash_attn-2.7.4%2Bcu124torch2.6.0cxx11abiFALSE-cp312-cp312-win_amd64.whl"
                echo "    Installing flash-attn for Python 3.12, torch 2.6.0, CUDA 12.4..."
                uv pip install "$FLASH_ATTN_WHEEL_URL"
                if validate_flash_attn; then
                    echo "    flash-attn import check passed."
                else
                    echo "    flash-attn import check failed; removing it and continuing with SDPA."
                    uv pip uninstall flash-attn
                fi
            else
                echo "    No known wheel for Python tag $PY_TAG, torch $TORCH_TAG, CUDA $CUDA_TAG."
                echo "    Continuing with PyTorch SDPA attention."
            fi
        fi
    fi
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
    if [[ -z "${VIBEPOD_CPU_THREADS:-}" ]]; then
        VIBEPOD_CPU_THREADS="$(uv run --no-sources python -c "import os; print(max(1, (os.cpu_count() or 2) // 2))")"
        export VIBEPOD_CPU_THREADS
    fi
    export OMP_NUM_THREADS="${OMP_NUM_THREADS:-$VIBEPOD_CPU_THREADS}"
    export MKL_NUM_THREADS="${MKL_NUM_THREADS:-$VIBEPOD_CPU_THREADS}"
    # Dynamic INT8 quantization — on by default for CPU (~22% faster, prediction_head
    # excluded automatically to avoid regression on small fixed-size tensors).
    # Set VIBEPOD_QUANTIZE=0 to disable if you notice audio quality differences.
    export VIBEPOD_QUANTIZE="${VIBEPOD_QUANTIZE:-1}"
    # Optional CPU flags:
    #   VIBEPOD_ASYNC_DECODE=0  Disable async decode/tts_lm overlap (on by default)
    #   VIBEPOD_CPU_BF16=1      Force bfloat16 weights (auto-detected via AVX512_BF16)
    #   VIBEPOD_COMPILE=1       torch.compile hot paths (ineffective for autoregressive
    #                           models on CPU — not recommended, kept for experimentation)
    UV_RUN_ARGS=(--no-sync --no-sources)
else
    export VIBEPOD_DEVICE="cuda"
    UV_RUN_ARGS=()
fi

exec uv run "${UV_RUN_ARGS[@]}" uvicorn vibevoice_server:app \
    --host 127.0.0.1 \
    --port 8000 \
    --log-level info \
    "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}"
