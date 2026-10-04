# VibePod Studio

A local script-first podcast studio for an NVIDIA GPU. Write or import a conversation, assign cloned or designed voices, generate immutable line takes, audition alternatives, and export the selected episode to podcast-ready MP3 or WAV.

## Windows setup

Install a current NVIDIA driver, Git, and Microsoft App Installer (`winget`). From PowerShell in the repository root:

```powershell
./setup.ps1 -InstallTools
pnpm dev
```

Setup installs the required tools, locked dependencies and pinned model checkpoints, then checks CUDA and audio encoders. The verified target is RTX 4070 12 GB with Python 3.12.9 and torch/torchaudio 2.8.0 CUDA 12.8. SDPA is the default; Flash Attention is optional. Ordinary startup installs nothing, manages both services, and hides routine request logs. Ctrl+C stops both owned service trees. Use `pnpm run doctor` for installation checks.

See [Windows setup and development](docs/windows-development.md) for prerequisites, custom paths/ports, interrupted downloads and troubleshooting. Setup/start have been tested on the current Windows machine; a clean Windows installation test is deferred.

Open http://localhost:3000. Create an episode and paste a script as `Speaker: line`, one block per line, or write blocks directly. Add a voice by uploading a clean 3–30 second WAV, or describe a voice, audition its designed preview and save it. Assign the saved voices to the cast and generate the episode. The first generation loads/downloads the pinned public checkpoint and can take several minutes; models run locally thereafter. An optional reference transcript enables transcript-assisted cloning.

Each regeneration adds an immutable take. Audition alternatives in the inspector and select the one to use. Text or voice changes mark earlier selections stale; Generate missing includes stale blocks. Autosave retains the script, cast, gaps and selection. The transport previews ready selected takes in script order, keeping the gaps between them and reporting how many unfinished lines are skipped. Start from any ready selected block without exporting or waiting for the whole episode. Finishing more takes does not interrupt a playing preview; pause or finish playback to refresh it. Library reopens episodes and keeps standalone audio accessible.

Install FFmpeg on PATH for export. Choose MP3 (192 kbps) or WAV (24-bit/48 kHz), add title/show/episode metadata and optional square JPG/PNG cover art for MP3. Background exports capture the selected takes and gaps when started, normalize mono speech to −19 LUFS, and verify encoded loudness within ±1 LU and true peak below −1 dB before exposing a download. Finished exports remain listed against the episode after reopening. A restart explicitly fails unfinished work; completed files remain available.

Python environments live outside the checkout under `%LOCALAPPDATA%/VibePod/environments`, with a separate identifier for each checkout. Models and cache are shared under `%LOCALAPPDATA%/VibePod`. Set `VIBEPOD_VENV`, `VIBEPOD_MODEL_PATH`, `VIBEPOD_DESIGN_MODEL_PATH` or `HF_HOME` before setup to customize paths. Setup preserves saved paths and ports on reruns; explicit environment overrides take precedence. Configuration lives in ignored `.vibepod/config.json`. CPU mode is unsupported.

Both services bind to loopback. The launcher supplies Next with the configured Python address. Keep the frontend local; it has no authentication and is intended for a trusted local user.

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
pnpm test:launcher
pnpm exec prettier --check .
$config = Get-Content .vibepod/config.json -Raw | ConvertFrom-Json
cd server
& $config.python -m ruff check .
& $config.python -m ruff format --check .
& $config.python -m unittest discover -s tests
```

See [the model evidence](docs/model-spike.md) and [the build plan](docs/studio-build-plan.md).
