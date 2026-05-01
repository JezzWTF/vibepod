# VibePod

A text-to-speech podcast generator powered by [VibeVoice 0.5B](https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B). Paste a script, tune a couple of sliders, and get a WAV back.

## Architecture

```
VibePod/
├── web/        Next.js 15 frontend (React 19, Tailwind CSS 4, TypeScript)
└── server/     FastAPI TTS backend  (Python 3.10+, VibeVoice, UV)
```

The Next.js app proxies audio generation requests to the FastAPI server, keeping CORS out of the picture and the Python model off the browser.

## Prerequisites

| Tool                               | Install                             |
| ---------------------------------- | ----------------------------------- |
| [Node.js 20+](https://nodejs.org)  | `winget install OpenJS.NodeJS.LTS`  |
| [pnpm](https://pnpm.io)            | `npm i -g pnpm`                     |
| [Python 3.10+](https://python.org) | `winget install Python.Python.3.13` |
| [uv](https://docs.astral.sh/uv/)   | `winget install astral-sh.uv`       |

## Getting started

```bash
# 1. Clone
git clone https://github.com/JezzWTF/vibepod.git
cd vibepod

# 2. Install Node dependencies (root + web workspace)
pnpm install

# 3. Copy env file and fill in values
cp .env.example .env.local

# 4. Start everything
pnpm dev          # CUDA (requires NVIDIA GPU + driver >= 525.60)
pnpm dev:cpu      # CPU-only (no GPU required)
```

`pnpm dev` / `pnpm dev:cpu` start both services concurrently:

- **SERVER** — `http://localhost:8000` — on first run uv creates the Python venv and downloads the ~1 GB VibeVoice model from HuggingFace
- **WEB** — `http://localhost:3000` — Next.js dev server with Turbopack

The frontend shows a loading indicator while the model downloads. Once the server reports `status: online`, generation is available.

## CUDA vs CPU

VibePod maintains two completely separate Python virtual environments so CUDA and CPU torch installs never conflict:

| Mode           | Command        | venv               | torch source            |
| -------------- | -------------- | ------------------ | ----------------------- |
| CUDA (default) | `pnpm dev`     | `server/.venv`     | PyTorch CUDA 12.4 index |
| CPU-only       | `pnpm dev:cpu` | `server/.venv-cpu` | PyPI (CPU wheel)        |

On first run, each mode creates its own venv automatically. You can switch between them freely — they are fully independent. The active device is reported by the `/health` endpoint as `"device": "cpu"` or `"device": "cuda"`.

> **CUDA requirement:** driver >= 525.60 (RTX 30/40 series all qualify). Run `nvidia-smi` to check.

## Individual commands

```bash
pnpm dev              # CUDA — server + web
pnpm dev:cpu          # CPU  — server + web
pnpm dev:server       # CUDA — Python server only
pnpm dev:server:cpu   # CPU  — Python server only
pnpm dev:web          # Next.js only (no Python server)
pnpm build            # Production build of the frontend
```

## Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable               | Default                 | Description                                               |
| ---------------------- | ----------------------- | --------------------------------------------------------- |
| `VIBEVOICE_SERVER_URL` | `http://localhost:8000` | URL the Next.js API routes use to reach the Python server |
| `HF_TOKEN`             | —                       | HuggingFace token (required if the model repo is gated)   |
| `HF_HOME`              | —                       | Override the HuggingFace model cache directory            |

## Project structure

```
web/
├── app/
│   ├── api/generate/   Proxies POST requests to the Python server
│   ├── api/health/     Proxies health checks (status: loading | online | error)
│   ├── page.tsx        Main UI — script input, controls, audio player
│   └── layout.tsx
├── components/
│   ├── Header.tsx
│   ├── TextInputPanel.tsx
│   ├── GenerationControls.tsx   cfg_scale and inference_steps sliders
│   ├── AudioPlayer.tsx
│   └── StatusLog.tsx
└── hooks/
    └── useAudioPlayer.ts

server/
├── vibevoice_server.py   FastAPI app — /health and /generate endpoints
├── download_model.py     One-shot HuggingFace model prefetch
├── start.sh              Entry point: uv sync → model check → uvicorn
└── pyproject.toml        Python deps managed by uv
```

## Generation parameters

| Parameter         | Range                                               | Default  | Effect                                         |
| ----------------- | --------------------------------------------------- | -------- | ---------------------------------------------- |
| `speaker`         | `carter`, `davis`, `emma`, `frank`, `grace`, `mike` | `carter` | Voice preset used for the generated audio      |
| `cfg_scale`       | 0.5 – 4.0                                           | 1.5      | Higher = more expressive guidance              |
| `inference_steps` | 5 – 20                                              | 10       | More steps = higher quality, slower generation |

## How it works

1. The user pastes a script and hits **Generate**
2. The Next.js `/api/generate` route forwards the request to FastAPI on port 8000
3. FastAPI runs the text through the VibeVoice streaming processor and inference model
4. Audio chunks stream back to the browser as SSE events containing base64 float32 PCM
5. The browser plays the chunks live, assembles a WAV Blob, and loads it into the audio player

## Python dependencies

Managed by [uv](https://docs.astral.sh/uv/). The `server/uv.lock` is committed so installs are fully reproducible.

```bash
# Add a package
cd server && uv add <package>

# Upgrade all dependencies
cd server && uv lock --upgrade
```

> **Note:** The `[tool.uv.sources]` block in `pyproject.toml` pulls torch from the PyTorch CUDA 12.4 index by default. Running with `--cpu` (or `uv sync --no-sources`) bypasses this and installs the standard PyPI CPU wheel instead.
