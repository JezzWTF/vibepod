# VibePod — Agent Guide

Two services: Python 3.12.9 FastAPI/Qwen backend on loopback port 8000 (`server/tts_server.py`), Next.js 15 / React 19 frontend on 3000. Browser requests go through Next API proxies.

The supported target is CUDA on an RTX 4070 12 GB. Use `server/start.ps1` on Windows or `pnpm dev` in Git Bash. CPU mode is removed. GPU-free environments can run fake-adapter API tests and build the frontend, but cannot validate inference.

Manage Python dependencies with uv; never pip directly. Torch and torchaudio 2.8.0 come from the explicit CUDA 12.8 index. Generate lock changes with `uv lock`; never edit `uv.lock` manually. Launch with frozen sync. `VIBEPOD_VENV` selects an external environment.

Only `model_adapter.py` imports Qwen/torch/transformers. Keep GPU work on the serialized worker. Keep queued jobs durable, cancellation races safe, and old Phase 1 database records readable. Store user data under ignored `data/`; never commit references or generated WAVs.

Read README.md and docs/studio-build-plan.md for scope and setup. Run Ruff, meaningful API/store tests, Next production build, and formatting checks for changes. Do not claim GPU validation from fake-adapter tests.

Commit messages need a title and a description of changes.
