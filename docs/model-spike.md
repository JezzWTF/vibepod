# Studio model spike — RTX 4070 (#17)

Run on GlassBox, Windows 11, NVIDIA RTX 4070 (12 GB), 2026-10-04.
Choose **Qwen3-TTS 12Hz 1.7B Base with SDPA** for the Studio adapter; use
VoiceDesign to create reusable reference voices. The user preferred Qwen's
clarity and accent. Its independent line outputs map directly to stored takes,
and its memory footprint leaves room on the 4070. The tradeoff is latency:
the measured SDPA dialogue takes 3.4 times its audio duration to generate.
The original `feat/studio` checkout, including pre-reset uncommitted Studio work,
has been preserved. The spike branch starts at `origin/main` (`f4d759c`).

## Protocol

- Python 3.12.9, torch/torchaudio 2.8.0+cu128, bfloat16, CUDA device 0.
- Shared 509-word, ten-block, two-speaker script in `server/spike/script.json`.
- Identical three-second references: upstream Alice at 16 kHz, Frank at 24 kHz.
- Qwen Base uses x-vector-only cloning. VibeVoice uses speech prefill.
- Qwen generates individual blocks, joined with 250 ms silence. VibeVoice
  generates the whole script in one pass.
- GPU runs are serial. Timings exclude download, loading, warmup and WAV writes;
  include preprocessing and synchronized generation. Peak allocation includes
  the resident model, and excludes other applications' VRAM.
- Seed 42 for the episode, 43 for the regenerated middle block. VibeVoice uses
  CFG 1.3 / 10 diffusion steps and deterministic sampling; Qwen uses its release
  generation defaults with a 4096-token ceiling.
- Wave files are validated for nonempty finite samples and saved as PCM16.
  Manifests record input/reference hashes, model revisions and package versions.

## Measurements

| Candidate                          | Attention |    Audio | Generation | Seconds per audio minute | Peak allocated | Peak reserved |
| ---------------------------------- | --------- | -------: | ---------: | -----------------------: | -------------: | ------------: |
| VibeVoice 1.5B, full dialogue      | SDPA      | 159.47 s |   253.32 s |                  95.31 s |       5333 MiB |      5830 MiB |
| VibeVoice 1.5B, line retake        | SDPA      |  22.00 s |    36.74 s |                 100.21 s |       5253 MiB |      5830 MiB |
| Qwen3-TTS 1.7B Base, full dialogue | SDPA      | 165.21 s |   562.49 s |                 204.28 s |       4404 MiB |      4932 MiB |
| Qwen3-TTS 1.7B Base, line retake   | SDPA      |  16.16 s |    61.96 s |                 230.04 s |       4382 MiB |      4932 MiB |
| Qwen Base, first two blocks        | SDPA      |  32.97 s |   112.14 s |                 204.08 s |       4392 MiB |      4802 MiB |
| Qwen Base, same first two blocks   | FA2       |  31.77 s |   100.88 s |                 190.53 s |       4375 MiB |      4804 MiB |
| Qwen VoiceDesign, two short lines  | SDPA      |   7.69 s |    23.70 s |                 184.88 s |       4074 MiB |      4140 MiB |

VibeVoice load took 12.52 s, Qwen Base 10.80 s, VoiceDesign 10.09 s. Both full
dialogues are about three minutes. Qwen episode durations include the assembly
gaps. The design smoke uses shorter text, so its throughput is not a direct
full-dialogue comparison. Voice design was prompted with a warm, clear female
British podcast host, conversational and thoughtful; the generated WAVs and
seed-43 retake are valid 24 kHz mono audio.

## Listening and regeneration

VibeVoice's full episode and Qwen's first cloned-voice block were presented in
the chat. The user found both acceptable, with more clarity and a less whiny
accent in Qwen. This favours Qwen alongside its direct per-block take model.
Full-episode Qwen speaker consistency and replacement-in-context review remain
available in the generated WAVs for further audition. No numerical quality score
has been invented from runtime data. The full Qwen episode and a three-line
context excerpt with the middle take replaced were also presented in the chat.

Both models support separate single-line generation. Qwen returns a take that
already corresponds to a script block. Replacing a line inside VibeVoice's
continuous episode needs alignment and splicing; there are no automatic block
boundaries in that output. A VibeVoice adapter could instead synthesize each
block independently, sacrificing whole-conversation context. Listening must
check whether those standalone replacements match the surrounding voices.

## Windows setup findings

- Qwen: `qwen-tts==0.1.1`, Transformers 4.57.3, Accelerate 1.12.0.
- VibeVoice community commit `952326ddb264062466a888cf32a5b2f4e803e16e`:
  Transformers 4.51.3, Accelerate 1.6.0, PEFT 0.15.2, Diffusers 0.33.1.
  Latest Diffusers 0.39.0 failed import with this PEFT version.
- E: ran out of space while copying the Windows CUDA wheel. The task's failed
  environments were moved to C:, then fresh environments installed beside
  uv's cache to share files through hardlinks. Existing environments were kept.
- Install torch/torchaudio from the CUDA index first; resolve other packages
  from PyPI while constraining the installed CUDA versions. Applying uv's
  first-index strategy to all dependencies selected old Requests on the CUDA
  index and prevented the VibeVoice dependency resolution.
- Long Hub transfers stalled. Explicit unauthenticated downloads with progress
  bars disabled advanced initially, but stalled again. A bounded HTTP range
  fallback resumed task-owned partial files and verified the published LFS
  SHA256 values before loading the checkpoints. Existing HF credentials were
  not changed. An independent diagnostic against the original cache found an
  expired OAuth token, so public models use no implicit token.
- Qwen prints a missing SoX binary warning at import, but the completed warmup
  and first two cloning takes work without the binary.

## Flash attention investigation

The matching wheel from [mjun0812 v0.7.11](https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/tag/v0.7.11)
is `flash_attn-2.8.3+cu128torch2.8-cp312-cp312-win_amd64.whl`.
Its GitHub asset SHA256 is
`2d1c4dd2df33792f7aec7f6611a2a5eb8ec2b3b0da63d2de618ea82b7d1a4be1`.
The downloaded wheel matches that digest and imports in the isolated VibeVoice
environment with einops 0.8.2. After the user's Qwen preference, the queued
comparison was redirected to Qwen's first two full-script blocks, with identical
references, seed and warmup, after the SDPA baseline finished.

FA2 reduced wall time by 10.0%, but generated shorter audio: normalized time per
audio minute improved only **6.6%**. Allocation was essentially unchanged. This
small, single-run comparison does not establish a robust advantage large enough
to justify making a native Windows wheel mandatory. **Use SDPA by default**.
`server/spike/install_flash.ps1` remains available for optional experiments; it
selects a wheel by runtime Python/torch/CUDA tags and verifies its asset SHA256.
The helper was tested against the installed matching wheel. This replaces a
single hardcoded runtime-specific wheel with a checked lookup for experiments.

## Immutable checkpoints

- Qwen Base: `fd4b254389122332181a7c3db7f27e918eec64e3`.
- Qwen VoiceDesign: `5ecdb67327fd37bb2e042aab12ff7391903235d3`.
- VibeVoice 1.5B: `c00898d257e6b46004e3e2866a47534085fb685a`.

All LFS weight files were verified against their published SHA256 values.

## Reproduce

See [the benchmark instructions](../server/spike/README.md), including the
tested package freezes and PowerShell setup script. Generated WAVs, model
weights and task environments are excluded from Git. Runtime evidence lives in
`server/spike/results/{qwen-full,vibevoice-full,qwen-flash,qwen-design}` on the
spike worktree. Successful runs have `complete.json` alongside manifests and
measurements. The preliminary `clone-sdpa` directory used incorrectly relabelled
references before any valid comparison; it is excluded from these results.
