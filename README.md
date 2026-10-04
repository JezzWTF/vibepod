# VibePod Studio

A local script-first podcast studio for an NVIDIA GPU. This rebuild delivers saved line takes with Qwen3-TTS 1.7B, reusable cloned voices, waveform previews, and a persistent library. Episode editing (#19) and feed-ready export (#20) follow later.

## Windows setup

Install uv, Node.js, pnpm, and a recent NVIDIA driver. The verified target is RTX 4070 12 GB with Python 3.12.9 and torch/torchaudio 2.8.0 CUDA 12.8. Dependencies are locked in `server/uv.lock`; SDPA is the default attention implementation. Flash attention remains an optional spike experiment, not a runtime dependency.

From the repository root, in separate PowerShell terminals:

```powershell
pnpm install --frozen-lockfile
./server/start.ps1
pnpm dev:web
```

Open http://localhost:3000. Upload a clean 3–30 second WAV, name the voice, write a line, and generate. Takes appear in Library, where they can be played, downloaded, or deleted. The first take loads/downloads the pinned public Base checkpoint and can take several minutes; models run locally thereafter. An optional exact transcript enables transcript-assisted cloning; leave it blank for speaker-embedding cloning.

The Windows launcher places the environment under `%LOCALAPPDATA%/VibePod/venv`, saving workspace disk space. Override with `VIBEPOD_VENV`. For Git Bash, `pnpm dev` runs both services and uses `server/.venv` unless overridden. CPU mode is unsupported.

Optional environment variables (set in the shell before starting):

```powershell
$env:VIBEPOD_MODEL_PATH = 'C:/models/qwen-base'
$env:VIBEPOD_DESIGN_MODEL_PATH = 'C:/models/qwen-design'
$env:VIBEPOD_VENV = 'C:/venvs/vibepod'
$env:VIBEPOD_PORT = '8000'
```

For a prefetch resilient to interrupted downloads, run `uv run spike/download.py Qwen/Qwen3-TTS-12Hz-1.7B-Base C:/models/qwen-base` from `server`. `HF_HOME` selects the Hugging Face cache. The public models need no login.

Set `VIBEPOD_SERVER_URL` in `web/.env.local` if changing the backend address. The server binds to loopback. Keep the frontend local too; it has no authentication and is intended for a trusted local user.

## Data and API

`data/db/vibepod.db` retains the Phase 1 SQLite generation rows. New `take_` records share this store; completed audio and waveform JSON live under `data/generations/<id>`. References live under `data/voices`. Back up the whole `data` directory. Data is ignored by Git.

- `GET /health`, `GET /voices`, `POST /voices` (multipart name, file, optional transcript)
- `POST /takes` with `{ "text": "Hello", "voice_id": "voice_...", "seed": 42 }` returns a persisted queued take (202).
- `GET /takes`, `GET /takes/{id}`, `POST /takes/{id}/cancel`
- `GET /takes/{id}/audio`, `GET /takes/{id}/waveform`, `DELETE /takes/{id}`

One worker serializes GPU work. Cancellation stops decoding and prevents publishing a completed result; deletion waits until the worker releases it. Restart marks unfinished takes interrupted. Read/delete `/generations` aliases retain Phase 1 compatibility. Old tuning fields remain only in the database to read existing records.

Only `server/model_adapter.py` imports the model runtime. Its `synthesize(text, voice, settings)` returns audio; `design` creates a reference with VoiceDesign, unloading Base first to stay within VRAM. Designing voices in the product UI is future work.

## Checks

```powershell
pnpm build
pnpm format:check
cd server
uv run ruff check .
uv run python -m unittest discover -s tests
```

See [the model evidence](docs/model-spike.md) and [the build plan](docs/studio-build-plan.md).
