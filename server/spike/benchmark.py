"""GPU-only model spike. Run each candidate in its own uv environment."""

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import os
import platform
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parent


def measure(label, output_dir, operation):
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    start = time.perf_counter()
    audio, rate = operation()
    torch.cuda.synchronize()
    elapsed = time.perf_counter() - start
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError(f"{label}: empty or non-finite audio")
    path = output_dir / f"{label}.wav"
    sf.write(path, audio, rate, subtype="PCM_16")
    seconds = len(audio) / rate
    record = {
        "name": label,
        "wav": str(path.resolve()),
        "generation_seconds": elapsed,
        "audio_seconds": seconds,
        "seconds_per_audio_minute": elapsed / seconds * 60,
        "peak_allocated_mib": torch.cuda.max_memory_allocated() / 2**20,
        "peak_reserved_mib": torch.cuda.max_memory_reserved() / 2**20,
        "sample_rate": rate,
    }
    print(json.dumps(record), flush=True)
    with (output_dir / "measurements.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return audio, rate, record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate", choices=["qwen", "vibevoice", "design", "clone"])
    parser.add_argument("--attention", default="sdpa", choices=["sdpa", "flash_attention_2"])
    parser.add_argument("--script", type=Path, default=ROOT / "script.json")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--refs", type=Path, help="Directory with speaker-1.wav and speaker-2.wav")
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--model-path", type=Path, help="Verified local checkpoint instead of Hub download"
    )
    args = parser.parse_args()
    # Public checkpoints need no auth, and progress bars can stall Windows pipes.
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    if not torch.cuda.is_available():
        raise RuntimeError("The spike requires CUDA; CPU is not a supported target")
    output = args.output or ROOT / "results" / f"{args.candidate}-{args.attention}"
    output.mkdir(parents=True, exist_ok=False)
    script_bytes = args.script.read_bytes()
    script = json.loads(script_bytes)
    if args.smoke:
        script = [
            dict(speaker=1, text="Welcome to VibePod. Can we fix just one line?"),
            dict(speaker=2, text="Yes. Keep every take, and choose the one you like."),
        ]
    versions = {}
    for package in [
        "torch",
        "torchaudio",
        "transformers",
        "qwen-tts",
        "vibevoice",
        "accelerate",
        "flash-attn",
        "diffusers",
        "peft",
    ]:
        with contextlib.suppress(importlib.metadata.PackageNotFoundError):
            versions[package] = importlib.metadata.version(package)
    manifest = {
        "candidate": args.candidate,
        "attention": args.attention,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cuda": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(),
        "versions": versions,
        "script_sha256": hashlib.sha256(script_bytes).hexdigest(),
        "smoke": args.smoke,
        "seed": 42,
        "listening_review": "PENDING",
    }
    (output / "input.json").write_text(json.dumps(script, indent=2), encoding="utf-8")
    if args.model_path and (args.model_path / "spike-source.json").exists():
        manifest["checkpoint_source"] = json.loads(
            (args.model_path / "spike-source.json").read_text(encoding="utf-8")
        )
    if args.refs:
        manifest["reference_sha256"] = {
            f"speaker-{speaker}.wav": hashlib.sha256(
                (args.refs / f"speaker-{speaker}.wav").read_bytes()
            ).hexdigest()
            for speaker in {line["speaker"] for line in script}
        }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    torch.manual_seed(42)
    load_start = time.perf_counter()
    if args.candidate in {"qwen", "design", "clone"}:
        from qwen_tts import Qwen3TTSModel

        variant = {"qwen": "CustomVoice", "design": "VoiceDesign", "clone": "Base"}[args.candidate]
        model_id = f"Qwen/Qwen3-TTS-12Hz-1.7B-{variant}"
        model = Qwen3TTSModel.from_pretrained(
            str(args.model_path) if args.model_path else model_id,
            device_map="cuda:0",
            dtype=torch.bfloat16,
            attn_implementation=args.attention,
            token=False,
        )
        speakers = {1: "Ryan", 2: "Aiden"}

        def synthesize(line):
            common = dict(
                text=line["text"], language="English", non_streaming_mode=True, max_new_tokens=4096
            )
            if args.candidate == "qwen":
                waves, rate = model.generate_custom_voice(
                    **common, speaker=speakers[line["speaker"]]
                )
            elif args.candidate == "design":
                waves, rate = model.generate_voice_design(
                    **common,
                    instruct="A warm, clear female British podcast host, conversational and thoughtful.",
                )
            else:
                if not args.refs:
                    raise ValueError("Cloning needs --refs with speaker-1.wav and speaker-2.wav")
                waves, rate = model.generate_voice_clone(
                    **common,
                    ref_audio=str(args.refs / f"speaker-{line['speaker']}.wav"),
                    x_vector_only_mode=True,
                )
            return waves[0], rate
    else:
        from vibevoice.modular.modeling_vibevoice_inference import (
            VibeVoiceForConditionalGenerationInference,
        )
        from vibevoice.processor.vibevoice_processor import VibeVoiceProcessor

        if not args.refs:
            raise ValueError("VibeVoice needs --refs with speaker-1.wav and speaker-2.wav")
        model_id = "microsoft/VibeVoice-1.5B"
        checkpoint = str(args.model_path) if args.model_path else model_id
        processor = VibeVoiceProcessor.from_pretrained(checkpoint, token=False)
        model = VibeVoiceForConditionalGenerationInference.from_pretrained(
            checkpoint,
            device_map="cuda",
            torch_dtype=torch.bfloat16,
            attn_implementation=args.attention,
            token=False,
        )
        model.eval()
        model.set_ddpm_inference_steps(num_steps=10)

        def conversation(lines):
            used = list(dict.fromkeys(line["speaker"] for line in lines))
            mapping = {speaker: index + 1 for index, speaker in enumerate(used)}
            text = "\n".join(
                f"Speaker {mapping[line['speaker']]}: {line['text']}" for line in lines
            )
            samples = [str(args.refs / f"speaker-{speaker}.wav") for speaker in used]
            inputs = processor(
                text=[text],
                voice_samples=[samples],
                padding=True,
                return_tensors="pt",
                return_attention_mask=True,
            )
            inputs = {
                key: value.to("cuda") if torch.is_tensor(value) else value
                for key, value in inputs.items()
            }
            result = model.generate(
                **inputs,
                max_new_tokens=8192,
                cfg_scale=1.3,
                tokenizer=processor.tokenizer,
                generation_config={"do_sample": False},
                verbose=False,
                is_prefill=True,
            )
            if result.reach_max_step_sample is not None and result.reach_max_step_sample.any():
                raise RuntimeError(
                    "VibeVoice hit its token limit; do not treat truncated audio as complete"
                )
            return (
                result.speech_outputs[0].detach().float().cpu().numpy(),
                processor.audio_processor.sampling_rate,
            )

        def synthesize(line):
            return conversation([line])

    torch.cuda.synchronize()
    manifest.update(model=model_id, load_seconds=time.perf_counter() - load_start)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    measure("warmup", output, lambda: synthesize(dict(speaker=1, text="Welcome to the studio.")))
    if args.candidate == "vibevoice":
        measure("episode", output, lambda: conversation(script))
    else:
        takes = [
            measure(f"line-{index:02}", output, lambda line=line: synthesize(line))
            for index, line in enumerate(script)
        ]
        rate = takes[0][1]
        if any(take[1] != rate for take in takes):
            raise ValueError("Sample rates differ between takes")
        gap = np.zeros(int(rate * 0.25), dtype=np.float32)
        episode = np.concatenate(
            [
                part
                for index, take in enumerate(takes)
                for part in ([gap, take[0]] if index else [take[0]])
            ]
        )
        sf.write(output / "episode.wav", episode, rate, subtype="PCM_16")
        summary = dict(
            name="episode",
            audio_seconds=len(episode) / rate,
            generation_seconds=sum(take[2]["generation_seconds"] for take in takes),
            peak_allocated_mib=max(take[2]["peak_allocated_mib"] for take in takes),
            peak_reserved_mib=max(take[2]["peak_reserved_mib"] for take in takes),
        )
        summary["seconds_per_audio_minute"] = (
            summary["generation_seconds"] / summary["audio_seconds"] * 60
        )
        (output / "episode.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(json.dumps(summary), flush=True)
    torch.manual_seed(43)
    target = script[len(script) // 2]
    retake = measure("regenerated-line", output, lambda: synthesize(target))
    if args.candidate != "vibevoice":
        takes[len(script) // 2] = retake
        replaced = np.concatenate(
            [
                part
                for index, take in enumerate(takes)
                for part in ([gap, take[0]] if index else [take[0]])
            ]
        )
        sf.write(output / "regenerated-episode.wav", replaced, rate, subtype="PCM_16")
    (output / "complete.json").write_text(
        json.dumps({"completed": True, "listening_review": "PENDING"}), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
