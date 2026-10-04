# VibePod Studio

A local script-first podcast studio for an NVIDIA GPU. Write or import a conversation, assign cloned or designed voices, generate immutable line takes, audition alternatives, and export the selected episode to podcast-ready MP3 or WAV.

## Windows setup

Install uv, Node.js, pnpm, and a recent NVIDIA driver. The verified target is RTX 4070 12 GB with Python 3.12.9 and torch/torchaudio 2.8.0 CUDA 12.8. Dependencies are locked in `server/uv.lock`; SDPA is the default attention implementation. Flash attention remains an optional spike experiment, not a runtime dependency.

From the repository root, in separate PowerShell terminals:

```powershell
pnpm install --frozen-lockfile
./server/start.ps1
pnpm dev:web
```

Open http://localhost:3000. Create an episode and paste a script as `Speaker: line`, one block per line, or write blocks directly. Add a voice by uploading a clean 3–30 second WAV, or describe a voice, audition its designed preview and save it. Assign the saved voices to the cast and generate the episode. The first generation loads/downloads the pinned public checkpoint and can take several minutes; models run locally thereafter. An optional reference transcript enables transcript-assisted cloning.

Each regeneration adds an immutable take. Audition alternatives in the inspector and select the one to use. Text or voice changes mark earlier selections stale; Generate missing includes stale blocks. Autosave retains the script, cast, gaps and selection. The transport plays the selected takes in order or starts from the selected block. Library reopens episodes and keeps standalone audio accessible.

Install FFmpeg on PATH for export. Choose MP3 (192 kbps) or WAV (24-bit/48 kHz), add title/show/episode metadata and optional square JPG/PNG cover art for MP3. Background exports capture the selected takes and gaps when started, normalize mono speech to −19 LUFS, and verify encoded loudness within ±1 LU and true peak below −1 dB before exposing a download. Finished exports remain listed against the episode after reopening. A restart explicitly fails unfinished work; completed files remain available.

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

Only `server/model_adapter.py` imports the model runtime. Its `synthesize(text, voice, settings)` returns audio; `design` creates a reusable reference with VoiceDesign, unloading Base first to stay within VRAM. GPU work is serialized separately from the CPU export worker.

Episode endpoints include `GET/POST /episodes`, `GET/PUT /episodes/{id}`, block `generate` and `select`, episode `generate?mode=all|missing|stale`, `cancel`, `audio`, and `exports`. Episode saves require the current revision and reject competing edits with 409. Design endpoints are `POST /voices/design` and `/voices/design/save`. Export creation uses multipart fields `format`, `title`, `show`, optional `number` and `artwork`; completed files are at `/episodes/{id}/exports/{exportId}/download`.

To verify a production build while a development preview is running, set `$env:VIBEPOD_CHECK_BUILD='1'` before `pnpm build`. This uses the separate ignored `web/.next-check` directory; normal builds and starts still use `.next`.

## Checks

```powershell
pnpm build
pnpm format:check
cd server
uv run ruff check .
uv run python -m unittest discover -s tests
```

See [the model evidence](docs/model-spike.md) and [the build plan](docs/studio-build-plan.md).
