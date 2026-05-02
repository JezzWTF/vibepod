# VibePod Roadmap

## Studio Vision

VibePod Studio will turn generated audio from a one-shot download into a reusable editing workspace. The core idea is to persist each generation as a project artifact with the source script, voice, generation settings, audio file, waveform peaks, and edit history, then expose those artifacts in a timeline editor.

## Phase 1: Generation Artifacts

- Store generated audio as server-side jobs instead of browser-only object URLs.
- Save job metadata: script, speaker, cfg scale, inference steps, duration, sample rate, created date, and generation status.
- Generate waveform peak data for fast timeline rendering.
- Add a library view for previous generations.

## Phase 2: Basic Studio Editor

- Add a Studio route with waveform timeline playback.
- Support trim start/end, split, delete range, silence insertion, fade in/out, and clip gain.
- Keep edits non-destructive by storing an edit decision list instead of rewriting the original audio immediately.
- Export edited audio as WAV first, then add compressed formats later.

## Phase 3: Regeneration Workflow

- Link script text ranges to generated audio ranges.
- Allow users to select a clip and regenerate just that segment.
- Support voice/settings changes per regenerated segment.
- Add replace, insert, and compare-take workflows.

## Phase 4: Multi-Speaker Projects

- Support script blocks with per-speaker assignment.
- Render speakers into separate timeline lanes.
- Add voice presets, reusable show templates, and episode-level settings.
- Support intro/outro/music beds once the audio engine can mix multiple lanes.

## Phase 5: Production Export

- Add loudness normalization, silence cleanup, and final mastering presets.
- Export MP3, WAV, and podcast-ready metadata.
- Add project save/load, autosave, and recoverable render jobs.
- Prepare the audio pipeline for queueing longer renders outside the request lifecycle.

## Later: VibeVoice Performance Research

- Move the current VibePod hot-path monkey patches into the `JezzWTF/VibeVoice` fork once the feature direction has settled.
- Add clearer generation profiling for overlapped CPU work, especially decode wait time versus total acoustic decode time.
- Prototype batched positive/negative CFG TTS LM inference behind an opt-in flag and benchmark it against the current sequential path on CPU and CUDA.
- Keep experimental performance work isolated from user-facing feature work unless it shows a clear speedup without audio quality regressions.

## Foundation Work Needed First

- Persist generated outputs with stable IDs.
- Move waveform and WAV assembly into reusable modules.
- Add cancellation-aware generation jobs.
- Add a backend audio processing layer for edits and exports.
- Keep the current generate screen as the fast path while Studio grows beside it.
