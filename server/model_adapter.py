"""The only boundary that knows about Qwen, torch, or CUDA."""

import gc
import os
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class Audio:
    samples: np.ndarray
    sample_rate: int


class Cancelled(Exception):
    pass


def runtime_info():
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Install/update the NVIDIA driver and rerun setup.")
    properties = torch.cuda.get_device_properties(0)
    return {
        "name": properties.name,
        "vram_gb": properties.total_memory / 2**30,
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
    }


class QwenAdapter:
    def __init__(self):
        os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
        import torch

        if not torch.cuda.is_available():
            raise RuntimeError("VibePod requires an NVIDIA CUDA GPU. CPU mode is unsupported.")
        self.model = None
        self.variant = None
        self.lock = threading.Lock()

    def _load(self, variant, progress=None):
        import torch
        from qwen_tts import Qwen3TTSModel

        if self.variant != variant:
            if progress:
                progress("loading_model")
            self.model = None
            self.variant = None
            gc.collect()
            torch.cuda.empty_cache()
            env = "VIBEPOD_MODEL_PATH" if variant == "Base" else "VIBEPOD_DESIGN_MODEL_PATH"
            source = os.environ.get(env, f"Qwen/Qwen3-TTS-12Hz-1.7B-{variant}")
            revision = {
                "Base": "fd4b254389122332181a7c3db7f27e918eec64e3",
                "VoiceDesign": "5ecdb67327fd37bb2e042aab12ff7391903235d3",
            }[variant]
            kwargs = {} if Path(source).exists() else {"revision": revision}
            self.model = Qwen3TTSModel.from_pretrained(
                source,
                device_map="cuda:0",
                dtype=torch.bfloat16,
                attn_implementation="sdpa",
                token=False,
                **kwargs,
            )
            self.variant = variant
        return self.model

    def synthesize(self, text, voice, settings, cancel=None, progress=None):
        import torch
        from transformers import StoppingCriteria, StoppingCriteriaList

        class Stop(StoppingCriteria):
            steps = 0

            def __call__(self, input_ids, scores, **kwargs):
                self.steps += 1
                if progress:
                    progress("synthesizing", self.steps)
                return bool(cancel and cancel.is_set())

        with self.lock:
            if cancel and cancel.is_set():
                raise Cancelled()
            model = self._load("Base", progress)
            if progress:
                progress("preparing_voice")
            torch.manual_seed(settings.get("seed", 42))
            # Qwen 0.1.1 drops arbitrary kwargs before talker.generate. Attach
            # cancellation here, only for the duration of this serialized call.
            talker = model.model.talker
            generate = talker.generate

            def cancellable_generate(*args, **kwargs):
                if progress:
                    progress("synthesizing", 0)
                kwargs["stopping_criteria"] = StoppingCriteriaList([Stop()])
                result = generate(*args, **kwargs)
                if cancel and cancel.is_set():
                    raise Cancelled()
                if result.sequences.shape[-1] >= kwargs["max_new_tokens"]:
                    raise RuntimeError("Line reached the generation limit; shorten it and retry.")
                return result

            talker.generate = cancellable_generate
            try:
                waves, rate = model.generate_voice_clone(
                    text=text,
                    language=voice.get("language", "English"),
                    ref_audio=voice["reference"],
                    ref_text=voice.get("transcript") or None,
                    x_vector_only_mode=not bool(voice.get("transcript")),
                    non_streaming_mode=True,
                    max_new_tokens=4096,
                )
            finally:
                talker.generate = generate
            if cancel and cancel.is_set():
                raise Cancelled()
            samples = np.asarray(waves[0], dtype=np.float32)
            if not samples.size or not np.isfinite(samples).all():
                raise RuntimeError("Model returned invalid audio")
            return Audio(samples, rate)

    def design(self, text, description, cancel=None, progress=None):
        from transformers import StoppingCriteria, StoppingCriteriaList

        class Stop(StoppingCriteria):
            steps = 0

            def __call__(self, input_ids, scores, **kwargs):
                self.steps += 1
                if progress:
                    progress("synthesizing", self.steps)
                return bool(cancel and cancel.is_set())

        with self.lock:
            if cancel and cancel.is_set():
                raise Cancelled()
            model = self._load("VoiceDesign", progress)
            talker = model.model.talker
            generate = talker.generate

            def cancellable_generate(*args, **kwargs):
                if progress:
                    progress("synthesizing", 0)
                kwargs["stopping_criteria"] = StoppingCriteriaList([Stop()])
                result = generate(*args, **kwargs)
                if cancel and cancel.is_set():
                    raise Cancelled()
                if result.sequences.shape[-1] >= kwargs["max_new_tokens"]:
                    raise RuntimeError(
                        "Voice preview reached the generation limit. Shorten the preview text."
                    )
                return result

            talker.generate = cancellable_generate
            try:
                waves, rate = model.generate_voice_design(
                    text=text,
                    instruct=description,
                    language="English",
                    non_streaming_mode=True,
                    max_new_tokens=1024,
                )
            finally:
                talker.generate = generate
            if cancel and cancel.is_set():
                raise Cancelled()
            samples = np.asarray(waves[0], dtype=np.float32)
            if not samples.size or not np.isfinite(samples).all():
                raise RuntimeError("Model returned invalid voice preview")
            return Audio(samples, rate)
