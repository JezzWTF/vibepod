# VibePod — Agent Guide

This file gives AI coding agents (Jules, Copilot, Claude Code, etc.) the context needed to work effectively on this repo without breaking the two-service setup.

---

## Project overview

VibePod is a text-to-speech web app. It has two services that must both run for the app to work:

| Service    | Language                           | Entry point                     | Port |
| ---------- | ---------------------------------- | ------------------------------- | ---- |
| **server** | Python 3.10+ (FastAPI + VibeVoice) | `server/start.sh`               | 8000 |
| **web**    | TypeScript (Next.js 15, React 19)  | `pnpm --filter vibepod-web dev` | 3000 |

The Next.js frontend proxies all model requests through its own API routes to the FastAPI server — it never calls the Python server directly from the browser.

---

## Environment (Jules sandbox)

- **No GPU** — always use CPU mode (`pnpm dev:cpu` / `start.sh --cpu`)
- Python venv lives at `server/.venv-cpu` — do **not** use `server/.venv`
- The VibeVoice model (~1 GB) is pre-downloaded to `~/.cache/huggingface` during setup
- Voice presets live at `server/voices/streaming_model/`
- `server/uv.lock` is committed and must not be modified — if `uv sync` rewrites it, run `git checkout server/uv.lock`

---

## Running the app

```bash
# Full stack — CPU (correct for Jules)
pnpm dev:cpu

# Full stack — CUDA (local dev with GPU)
pnpm dev

# Individual services
pnpm dev:server:cpu   # Python server, CPU only
pnpm dev:server       # Python server, CUDA
pnpm dev:web          # Next.js only

# Production build
pnpm build
```

---

## Device selection

The `--cpu` flag in `start.sh` sets `VIBEPOD_DEVICE=cpu` and uses a separate venv (`server/.venv-cpu`) so CUDA and CPU installs never conflict. `vibevoice_server.py` reads `VIBEPOD_DEVICE` at startup via `_resolve_device()` — do not remove or rename that function.

| Env var                  | Values                  | Set by                      |
| ------------------------ | ----------------------- | --------------------------- |
| `VIBEPOD_DEVICE`         | `cpu` \| `cuda`         | `server/start.sh`           |
| `UV_PROJECT_ENVIRONMENT` | `.venv-cpu` \| `.venv`  | `server/start.sh`           |
| `HF_TOKEN`               | HuggingFace token       | Jules secret / `.env.local` |
| `VIBEVOICE_SERVER_URL`   | `http://localhost:8000` | `.env.local`                |

---

## Python environment rules

- Python deps are managed by [uv](https://docs.astral.sh/uv/) — **never use pip directly**
- Always `cd server` before running uv commands
- Add a package: `uv add <package>`
- Remove a package: `uv remove <package>`
- Upgrade deps: `uv lock --upgrade`
- The `[tool.uv.sources]` block in `pyproject.toml` points torch at the CUDA 12.4 index — `--no-sources` bypasses this for CPU installs

---

## Key files

```
server/
├── vibevoice_server.py   FastAPI app — /health and /generate (SSE) endpoints
├── download_model.py     Standalone model prefetch script
├── start.sh             Startup: parses --cpu flag, syncs venv, launches uvicorn
└── pyproject.toml       Python deps (torch CUDA index configured here)

web/
├── app/api/generate/    Proxies POST → Python server, streams SSE to browser
├── app/api/health/      Proxies GET /health from Python server
└── app/page.tsx         Main UI

package.json             Root — defines all pnpm dev:* scripts
dev.sh                   Concurrent launcher (forwards flags to start.sh)
```

---

## API reference

### `GET /health`

Returns server status. Safe to poll.

```json
{
  "status": "online",
  "model": "microsoft/VibeVoice-Realtime-0.5B",
  "device": "cpu",
  "voices": ["carter", "davis", "emma", "frank", "grace", "mike"]
}
```

`status` values: `downloading` | `loading` | `online` | `error`

### `POST /generate`

Streams audio as SSE events.

```json
{ "text": "Hello world", "speaker": "carter", "cfg_scale": 1.5, "inference_steps": 10 }
```

Event types: `audio_chunk` (base64 float32 PCM) | `complete` | `error` | `cancelled`

---

## Do / Don't

**Do:**

- Use `pnpm dev:cpu` in Jules — never plain `pnpm dev`
- Run `git checkout server/uv.lock` if uv rewrites it during setup
- Keep `_resolve_device()` in `vibevoice_server.py` — it's the CPU/CUDA switching logic
- Test server changes against `GET /health` and `POST /generate`

**Don't:**

- Run `uv sync` without `UV_PROJECT_ENVIRONMENT=.venv-cpu` in the Jules sandbox
- Install Python packages with pip
- Modify `server/uv.lock` manually
- Remove the `[tool.uv.sources]` torch entry from `pyproject.toml` — it's needed for CUDA installs
