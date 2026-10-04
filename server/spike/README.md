# RTX 4070 model spike (#17)

This directory keeps the benchmark separate from the application. Run from
`server` in PowerShell. Python packages are installed with uv. The candidate
environments have incompatible Transformers/Accelerate pins and must stay separate.

```powershell
./spike/setup.ps1
$spikeRuntime = Join-Path $env:USERPROFILE '.codex/vibepod-spike'
$qwenPython = Join-Path $spikeRuntime 'qwen/Scripts/python.exe'
$vibevoicePython = Join-Path $spikeRuntime 'vibevoice/Scripts/python.exe'
$env:HF_HOME = Join-Path $spikeRuntime 'hf'
$env:HF_HUB_DISABLE_IMPLICIT_TOKEN = '1'
$env:HF_HUB_DISABLE_PROGRESS_BARS = '1'
```

`setup.ps1 -RuntimeRoot D:/vibepod-spike` can put environments on another drive.
The freezes record installed packages; the shorter requirements files explain
the important upstream/compatibility pins. Install CUDA wheels first, then
ordinary packages from PyPI. Using the CUDA index for all packages can select
old transitive dependencies under uv's first-index strategy.
These are public checkpoints: avoid importing an expired OAuth token from an
existing cache. Disabling progress bars also avoids stalls with Windows pipes.

Put two mono reference WAVs (about three seconds each) in `spike/results/refs-correct`,
named `speaker-1.wav` and `speaker-2.wav`. Use the same references for both
candidates. Qwen Base uses x-vector-only cloning so a reference transcript is
not required. This specifically tests short-sample cloning; transcript-assisted
cloning is a separate potential improvement. Upstream VibeVoice demo samples
can be used to make the test reproducible without personal voice recordings.
`prepare_refs.py <community-repo>/demo/voices spike/results/refs-correct` trims
Alice and Frank samples to three seconds at their original sample rates and
records their source and output hashes. Do not relabel the sample rate.

On GlassBox the long Hub HTTP transfers stalled after partial progress. The
fallback below uses immutable revisions, 64 MiB ranges, response-size checks
and published LFS SHA256 verification. Rerunning it resumes `.partial` files.
It records the resolved revision in `spike-source.json`. `--cache <task-hf>/hub`
can reuse this task's partial Hub blobs after its old download processes stop;
it moves those blobs, so use only a cache belonging to the spike.

```powershell
& $qwenPython spike/download.py Qwen/Qwen3-TTS-12Hz-1.7B-Base "$spikeRuntime/models/qwen-base"
& $vibevoicePython spike/download.py microsoft/VibeVoice-1.5B "$spikeRuntime/models/vibevoice"
& $qwenPython spike/download.py Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign "$spikeRuntime/models/qwen-design"
# Add --model-path to each benchmark command to use its verified local snapshot.
```

```powershell
& $qwenPython spike/benchmark.py clone --refs spike/results/refs-correct --smoke
& $vibevoicePython spike/benchmark.py vibevoice --refs spike/results/refs-correct --smoke
# Use new output directories for full runs (existing directories are refused).
& $qwenPython spike/benchmark.py clone --refs spike/results/refs-correct --output spike/results/qwen-full
& $vibevoicePython spike/benchmark.py vibevoice --refs spike/results/refs-correct --output spike/results/vibevoice-full
& $qwenPython spike/benchmark.py design --smoke
```

The shared script is roughly three minutes, depending on speaking speed. The
Qwen episode assembles line takes with a 250 ms gap; VibeVoice generates the
conversation in one pass. Generation timing includes model preprocessing and
GPU synchronization, excludes model loading/download, file writing, and warmup.
Each run records its script hash, seed, Python/package/CUDA versions, and GPU.
CUDA peaks include the resident model; they measure PyTorch allocations and
reservations, not total board use (desktop applications also consume VRAM).
JSONL measurements are flushed after each successful operation so a failed run
keeps its completed evidence. Audio duration and seconds per audio minute are
measured, not inferred from the word count. Line regeneration uses seed 43,
against seed 42 for the original episode.

Listen to each `episode.wav` and `regenerated-line.wav`. Record naturalness,
speaker consistency, turn-taking, and how the replacement fits its neighbours.
Automated generation cannot establish those listening criteria. VibeVoice's
one-line output needs manual alignment/splicing into its continuous episode;
Qwen's output already corresponds to an individual script block.

SDPA is the baseline. Do not install an unmatched Windows flash-attn wheel.
If benchmarking flash-attn, pass `--attention flash_attention_2` and use a
separate output directory with otherwise identical inputs. Record the actual
wheel and compare measured time, memory, and listening quality.

Sources: [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS),
[VibeVoice community](https://github.com/vibevoice-community/VibeVoice).

No model winner has been established until the complete benchmark and listening
review are recorded. Issue #18 depends on that choice.
