# Windows setup and development

VibePod keeps Next.js for the Studio and Python for GPU inference. One launcher manages both. Installation happens during setup, never during ordinary startup.

## Fresh Windows 11 installation

1. Install the current NVIDIA driver for your GPU from [NVIDIA](https://www.nvidia.com/en-us/drivers/), then restart Windows. The minimum is an NVIDIA GPU with 8 GB VRAM. Verified on an RTX 4070 12 GB; the models peak at about 5 GB while generating. That fit under an emulated 8 GB limit on the 4070, but a real 8 GB card has not been tried, so close other GPU-heavy applications if generation runs out of memory. CPU mode is unsupported. PyTorch supplies its CUDA runtime; a separate CUDA Toolkit or Flash Attention installation is unnecessary.
2. Install Microsoft App Installer if `winget` is missing. Install Git (`winget install --id Git.Git --exact`), reopen PowerShell, then clone this repository and enter it.
3. Run `./setup.ps1 -InstallTools`. This requests the winget packages for Node LTS, uv and FFmpeg (and Git), installs pnpm 11.28.4 when absent and checks that pnpm 11 is in use, installs Python 3.12.9 with uv, and synchronizes both lockfiles. Review any installer agreements/prompts yourself. Setup does not change your persistent PowerShell execution policy. If scripts are blocked, use a session-only policy permitted by your machine/organization.
4. Setup checks the actual CUDA GPU, VRAM, FFmpeg and ffprobe, then downloads/verifies both pinned public Qwen checkpoints. This is a large first-run download: allow time and disk space. Downloads resume after interruption; rerun setup. No Hugging Face login is needed.
5. Run `pnpm dev` (or `./start.ps1`). Open the URL printed after **Ready**. Ctrl+C stops the services owned by this launcher.

Prerequisites and setup failures are explicit; a missing GPU, driver, encoder, environment, or occupied port is not silently worked around. Installing tools may require elevation through the normal installer. If the new executable is not on PATH yet, reopen PowerShell and rerun setup.

## Existing tools and local paths

Run `./setup.ps1` when tools are already installed. Optional shell variables before setup:

```powershell
$env:VIBEPOD_VENV = 'C:/VibePod/venv'
$env:VIBEPOD_MODEL_PATH = 'C:/VibePod/models/qwen-base'
$env:VIBEPOD_DESIGN_MODEL_PATH = 'C:/VibePod/models/qwen-design'
$env:HF_HOME = 'C:/VibePod/huggingface'
./setup.ps1
```

Without overrides, models/cache live under `%LOCALAPPDATA%/VibePod`; Python environments use a per-checkout identifier under `environments`, so separate worktrees do not rewrite each other's environments. Configuration is saved in ignored `.vibepod/config.json`. Reruns retain saved paths and ports; explicit shell path overrides take precedence. Relative path overrides are resolved against the checkout before entering the backend directory. Back up `data/` separately: it contains episodes, voices, takes and exports.

`./setup.ps1 -SkipModels` skips prefetch, useful when reusing an existing installation. It is not an offline-readiness check; missing models download at first use. Normal setup verifies their pinned contents. Models are shared on disk; only one model variant is held on the GPU at a time.

## Normal development

```powershell
pnpm run doctor       # GPU, encoder, configuration and dependency stamp checks
pnpm dev          # both services; quiet request logs
pnpm dev --verbose # include frontend request logs
```

Ports default to web 3000 / backend 8000. Change `webPort` and `backendPort` in `.vibepod/config.json` together with any local preference. The launcher supplies the matching backend URL to Next; no separate `.env.local` edit is required. Both bind to `127.0.0.1`.

Startup refuses occupied ports and leaves their existing processes alone. It starts Python, waits for health, starts Next, and verifies health through the Next proxy. Readiness requests are quiet and stop after startup. There is no periodic supervisor health ping. Full child output is retained in `.vibepod/logs/python.log` and `next.log`; ordinary request lines are hidden in the terminal. Errors and lifecycle output remain visible.

Next runs in development mode, so frontend changes update live. Restart the launcher for Python changes; GPU inference does not run under an automatic reloader. Saved work survives restarts, but unfinished takes/exports are explicitly interrupted. If one service exits, the launcher stops the other rather than leaving a half-running application. Ctrl+C terminates only child trees it launched.

When lockfiles change, rerun setup. Startup compares their hash to the setup stamp and never attempts an implicit installation. To build without disrupting the preview:

```powershell
$env:VIBEPOD_CHECK_BUILD='1'
pnpm build
```

## Troubleshooting

- **CUDA unavailable:** update the NVIDIA driver, reboot, check `nvidia-smi`, then `pnpm run doctor`. No CPU fallback.
- **Port occupied:** stop the old preview yourself or change the configured ports. The launcher will not kill an unrelated server.
- **Missing dependencies / changed lock:** rerun setup in the same checkout.
- **Model download interrupted:** rerun normal setup; existing verified files are reused.
- **Server exited / readiness timeout:** read the corresponding file in `.vibepod/logs`. The other child is stopped automatically.
- **Codex command rejected before launch:** this is an agent execution-policy failure, separate from setup. Keep the exact rejection for troubleshooting; repeated user consent does not necessarily change that policy.

Setup and startup were exercised successfully by the user on the current Windows machine. Fresh-install testing is explicitly deferred; a fresh-install VM is the final check for installer/PATH behavior. Do not claim that a current-machine smoke test is a clean Windows installation.
