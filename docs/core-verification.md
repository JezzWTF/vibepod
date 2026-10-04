# Core verification — Studio restart (#18)

Verified on GlassBox / RTX 4070, 2026-10-04, using the frozen `server/uv.lock` runtime, CUDA 12.8 and SDPA. The new Windows launcher started FastAPI on loopback port 8018.

- Uploaded the spike's native-rate 3-second Alice reference through `POST /voices`.
- Generated through `POST /takes` and the Qwen adapter: a 6.32-second, 24 kHz mono PCM16 WAV with 151,680 finite samples, persisted metadata and 593 waveform peak buckets.
- Restarted the server and read the same take and audio back from SQLite/files.
- Audio range `bytes=0-43` returned HTTP 206.
- Final decoder-boundary adapter generated a second 4.40-second take.
- Queued cancellation remained cancelled. A long active decode was cancelled after 8 seconds; worker release and successful safe deletion took 0.235 seconds after cancellation. It published no completed take.
- Three API tests pass: Phase 1 schema migration and legacy playback; completion/assets; queued and active cancellation/delete race; restart recovery and invalid input.
- Next.js 15.5.15 production build, Ruff lint/format and Prettier checks pass.

Browser verification is pending: automatic approval review rejected local frontend preview startup with “blocked by policy,” without a specific reason. Approval requested; no claim of visual QA is made. The library route and take proxies compile in the production build, and the real API assets are verified.

No `podcast-forge` directory exists in the repository or parent workspace. The original dirty `feat/studio` checkout remains untouched.

Episode editing and podcast export remain #19/#20; the umbrella #13 is not resolved by this core PR.
