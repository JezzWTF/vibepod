# VibePod Studio

A local script-first podcast studio for an NVIDIA GPU. Write or import a conversation, assign cloned or designed voices, generate immutable line takes, audition alternatives, and export the selected episode to podcast-ready MP3 or WAV.

## Install

End users run the Windows installer and need only an NVIDIA GPU and current driver; see [desktop installation](docs/desktop-installation.md) for first launch, repair and how the installer is built. The sections below set up a development checkout.

## Windows development setup

Install a current NVIDIA driver, Git, and Microsoft App Installer (`winget`). From PowerShell in the repository root:

```powershell
./setup.ps1 -InstallTools
pnpm dev
```

Setup installs the required tools, locked dependencies and pinned model checkpoints, then checks CUDA and audio encoders. Any NVIDIA GPU with 8 GB or more VRAM is accepted; the verified target is RTX 4070 12 GB, and the models peak at about 5 GB while generating. That fit under an emulated 8 GB limit on the 4070, but a real 8 GB card has not been tried, so close other GPU-heavy applications if generation runs out of memory. Python 3.12.9 and torch/torchaudio 2.8.0 CUDA 12.8. SDPA is the default; Flash Attention is optional. Ordinary startup installs nothing, manages both services, and hides routine request logs. Ctrl+C stops both owned service trees. Use `pnpm run doctor` for installation checks.

See [Windows setup and development](docs/windows-development.md) for prerequisites, custom paths/ports, interrupted downloads and troubleshooting. Setup/start have been tested on the current Windows machine; a clean Windows installation test is deferred.

Open http://localhost:3000. Create an episode and paste a script as `Speaker: line`, one block per line, or write blocks directly. Add a voice by uploading a clean 3–30 second WAV, or describe a voice, audition its designed preview and save it. Assign the saved voices to the cast and generate the episode. The first generation loads/downloads the pinned public checkpoint and can take several minutes; models run locally thereafter. An optional reference transcript enables transcript-assisted cloning.

Each regeneration adds an immutable take. Audition alternatives in the inspector and select the one to use. Text or voice changes mark earlier selections stale; Generate missing includes stale blocks. Autosave retains the script, cast, gaps and selection. The transport previews ready selected takes in script order, keeping the gaps between them and reporting how many unfinished lines are skipped. Start from any ready selected block without exporting or waiting for the whole episode. Finishing more takes does not interrupt a playing preview; pause or finish playback to refresh it. Library reopens episodes and keeps standalone audio accessible. Episodes can be archived to keep Active focused, or moved to Trash and restored; nothing is erased automatically, and Trash blocks editing, generation and export until restored.

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

Episode endpoints include `GET/POST /episodes` (`GET ?state=active|archived|trashed` also returns per-state `counts`), `GET/PUT /episodes/{id}`, `POST /episodes/{id}/lifecycle` (`{ "action": "archive|trash|restore", "revision": n }`), block `generate` and `select`, episode `generate?mode=all|missing|stale`, `cancel`, `audio`, and `exports`. Episode saves require the current revision and reject competing edits with 409. Design endpoints are `POST /voices/design` and `/voices/design/save`. Export creation uses multipart fields `format`, `title`, `show`, optional `number` and `artwork`; completed files are at `/episodes/{id}/exports/{exportId}/download`.

To verify a production build while a development preview is running, set `$env:VIBEPOD_CHECK_BUILD='1'` before `pnpm build`. This uses the separate ignored `web/.next-check` directory; normal builds and starts still use `.next`.

## Write with AI

The Studio's **Write with AI** dialog researches a topic and writes a script. It drives the `claude` or `codex` command-line tool that is already signed in on this machine, exactly as typing the prompt into the app would, so it uses your subscription. VibePod never reads or stores a login. Ollama can draft from your own notes; it cannot search the web. Keep the CLIs updated, since an old one can reject the model your app uses.

A job runs in the background: research, outline, one draft per section, and an optional review. Each finished stage is saved, so a usage limit, cancellation or restart resumes where it stopped, and you can resume with a different provider. The result becomes a new episode or is appended to the open one, and the research sources stay with the episode under **Sources**. One script is written at a time.

The same pipeline runs from a terminal: `cd server`, then `python -m script_agent "topic" --provider claude --minutes 10`. Add `--import-to http://127.0.0.1:8000` to create the episode. Endpoints are `GET /script-providers` and `/script-jobs` (`POST`, `GET current|{id}`, `{id}/cancel|resume|discard|apply`).

## Checks

```powershell
pnpm build
pnpm test:launcher
pnpm test:desktop
pnpm exec prettier --check .
$config = Get-Content .vibepod/config.json -Raw | ConvertFrom-Json
cd server
& $config.python -m ruff check .
& $config.python -m ruff format --check .
& $config.python -m unittest discover -s tests
```

See [the model evidence](docs/model-spike.md) and [the build plan](docs/studio-build-plan.md).
