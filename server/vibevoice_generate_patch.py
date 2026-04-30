"""
VibePod CPU pipeline optimisation — patched VibeVoice generate() loop.

WHY THIS FILE EXISTS
--------------------
The VibeVoice inner speech-generation loop runs:

    decode(speech_latent)          # 87 ms — VAE decode to audio waveform
    audio_chunks.append(chunk)     # store for final return value
    audio_streamer.put(chunk)      # stream to client
    acoustic_connector(speech_latent) -> acoustic_embed   # 1 ms
    forward_tts_lm(acoustic_embed)                        # ~49 ms (positive)
    forward_tts_lm(acoustic_embed)                        # ~49 ms (negative CFG)

acoustic_connector and both forward_tts_lm calls depend only on speech_latent /
acoustic_embed — they are completely independent of the decoded audio waveform.
Running decode in a thread while connector + tts_lm run on the main thread hides
~87 ms of decode cost per token behind the ~99 ms of tts_lm work:

    Before: 87 + 1 + 49 + 49 = 186 ms / token
    After:  max(87, 1 + 49 + 49) = 99 ms / token  (~47 % reduction)

HOW IT WORKS
------------
At model load time, _install_cpu_pipeline_optimizations() in vibevoice_server.py:
  1. Creates a single-worker ThreadPoolExecutor and attaches it to the model as
     model._vibepod_decode_executor.
  2. Installs this module's `patched_generate` as a bound method on the model
     instance via types.MethodType, shadowing the class-level generate().

Because the patch lives on the *instance*, uv sync reinstalling the VibeVoice
package has no effect — Python resolves instance attributes before class ones.

MAINTENANCE
-----------
This is a verbatim copy of VibeVoice's generate() method (lines 574–910 of
modeling_vibevoice_streaming_inference.py) with the inner speech loop reordered.
The only changed region is marked with  # [VibePod]  comments.

If VibeVoice updates its generate() method, diff the new version against this
file and merge carefully.  The sentinel string "[VibePod]" marks every changed
line to make diffing easy.
"""

import concurrent.futures
import types
from typing import Callable, List, Optional, Union

import torch
from tqdm import tqdm
from transformers.generation import GenerationConfig, LogitsProcessorList, StoppingCriteriaList
from transformers.modeling_utils import PreTrainedModel

from vibevoice.modular.modeling_vibevoice_streaming_inference import (
    TTS_TEXT_WINDOW_SIZE,
    TTS_SPEECH_WINDOW_SIZE,
    VibeVoiceGenerationOutput,
    _update_model_kwargs_for_generation,
)
from vibevoice.modular.modular_vibevoice_tokenizer import VibeVoiceTokenizerStreamingCache
from vibevoice.modular.streamer import AudioStreamer, AsyncAudioStreamer


def patched_generate(
    self,
    inputs: Optional[torch.Tensor] = None,
    generation_config: Optional[GenerationConfig] = None,
    logits_processor: Optional[LogitsProcessorList] = None,
    stopping_criteria: Optional[StoppingCriteriaList] = None,
    prefix_allowed_tokens_fn: Optional[Callable[[int, torch.Tensor], List[int]]] = None,
    synced_gpus: Optional[bool] = None,
    assistant_model: Optional["PreTrainedModel"] = None,
    audio_streamer: Optional[Union[AudioStreamer, AsyncAudioStreamer]] = None,
    negative_prompt_ids: Optional[torch.Tensor] = None,
    negative_prompt_attention_mask: Optional[torch.Tensor] = None,
    speech_tensors: Optional[torch.FloatTensor] = None,
    speech_masks: Optional[torch.BoolTensor] = None,
    speech_input_mask: Optional[torch.BoolTensor] = None,
    tts_text_ids: Optional[torch.LongTensor] = None,
    return_speech: bool = True,
    cfg_scale: float = 1.0,
    stop_check_fn: Optional[Callable[[], bool]] = None,
    **kwargs,
) -> Union[torch.LongTensor, VibeVoiceGenerationOutput]:
    # ── Setup (unchanged from original) ─────────────────────────────────────
    tokenizer = kwargs.pop("tokenizer", None)
    neg_text_input_id = tokenizer.convert_tokens_to_ids("<|image_pad|>")

    tts_lm_input_ids = kwargs.pop("tts_lm_input_ids", None)
    tts_lm_attention_mask = kwargs.pop("tts_lm_attention_mask", None)
    all_prefilled_outputs = kwargs.pop("all_prefilled_outputs", None)
    tts_text_ids = tts_text_ids.to(self.device)

    if kwargs.get("max_new_tokens", None) is None:
        kwargs["max_new_tokens"] = (
            self.config.decoder_config.max_position_embeddings - tts_lm_input_ids.shape[-1]
        )

    generation_config, model_kwargs, input_ids, logits_processor, stopping_criteria = (
        self._build_generate_config_model_kwargs(
            generation_config, inputs, tokenizer, return_processors=True, **kwargs
        )
    )

    negative_kwargs = {
        "input_ids": torch.full(
            (kwargs["input_ids"].shape[0], 1),
            neg_text_input_id,
            dtype=torch.long,
            device=kwargs["input_ids"].device,
        ),
        "attention_mask": torch.ones(
            (kwargs["input_ids"].shape[0], 1),
            dtype=torch.long,
            device=kwargs["input_ids"].device,
        ),
        "max_new_tokens": kwargs.get("max_new_tokens", 100),
    }
    negative_generation_config, negative_model_kwargs, negative_input_ids = (
        self._build_generate_config_model_kwargs(
            None, None, tokenizer, return_processors=False, **negative_kwargs
        )
    )

    tts_lm_kwargs = {
        "input_ids": tts_lm_input_ids,
        "attention_mask": tts_lm_attention_mask,
        "max_new_tokens": kwargs.get("max_new_tokens", 100),
    }
    tts_lm_generation_config, tts_lm_model_kwargs, tts_lm_input_ids = (
        self._build_generate_config_model_kwargs(
            None, None, tokenizer, return_processors=False, **tts_lm_kwargs
        )
    )

    tts_lm_negative_kwargs = {
        "input_ids": torch.full(
            (kwargs["input_ids"].shape[0], 1),
            neg_text_input_id,
            dtype=torch.long,
            device=kwargs["input_ids"].device,
        ),
        "attention_mask": torch.ones(
            (kwargs["input_ids"].shape[0], 1),
            dtype=torch.long,
            device=kwargs["input_ids"].device,
        ),
        "max_new_tokens": kwargs.get("max_new_tokens", 100),
    }
    tts_lm_negative_generation_config, tts_lm_negative_model_kwargs, tts_lm_negative_input_ids = (
        self._build_generate_config_model_kwargs(
            None, None, tokenizer, return_processors=False, **tts_lm_negative_kwargs
        )
    )

    acoustic_cache = VibeVoiceTokenizerStreamingCache()
    batch_size = input_ids.shape[0]
    assert batch_size == 1, "Currently only supports batch size == 1"
    device = input_ids.device
    finished_tags = torch.zeros(batch_size, dtype=torch.bool, device=device)
    verbose = kwargs.get("verbose", False)

    audio_chunks = [[] for _ in range(batch_size)]
    tts_text_window_index = 0
    reach_max_step_sample = torch.zeros(batch_size, dtype=torch.bool, device=device)
    first_text_window_size = (
        TTS_TEXT_WINDOW_SIZE
        if tts_text_ids.shape[1] >= TTS_TEXT_WINDOW_SIZE
        else tts_text_ids.shape[1]
    )

    outputs = all_prefilled_outputs["lm"]
    tts_lm_outputs = all_prefilled_outputs["tts_lm"]
    negative_outputs = all_prefilled_outputs["neg_lm"]
    tts_lm_negative_outputs = all_prefilled_outputs["neg_tts_lm"]

    model_kwargs = _update_model_kwargs_for_generation(
        outputs, model_kwargs, num_new_tokens=first_text_window_size
    )
    tts_lm_model_kwargs = _update_model_kwargs_for_generation(
        tts_lm_outputs, tts_lm_model_kwargs, num_new_tokens=first_text_window_size
    )
    negative_model_kwargs = self._update_model_kwargs_for_generation(
        negative_outputs, negative_model_kwargs, is_encoder_decoder=False
    )
    tts_lm_negative_model_kwargs = self._update_model_kwargs_for_generation(
        tts_lm_negative_outputs, tts_lm_negative_model_kwargs, is_encoder_decoder=False
    )

    step = tts_lm_input_ids.shape[1]
    total_generated_speech_tokens = 0
    total_prefilled_text_tokens = 0
    if kwargs.get("show_progress_bar", True):
        progress_bar = tqdm(
            total=tts_lm_generation_config.max_length,
            desc=f"Prefilled {step} tokens, current step ({step} / {tts_lm_generation_config.max_length})",
            initial=step,
            leave=False,
        )
    else:
        progress_bar = None

    # [VibePod] Grab the executor once; None means standard sequential path.
    _vp_executor: Optional[concurrent.futures.ThreadPoolExecutor] = getattr(
        self, "_vibepod_decode_executor", None
    )

    # ── Main generation loop (unchanged from original) ───────────────────────
    while True:
        if stop_check_fn is not None and stop_check_fn():
            if verbose:
                print(f"Generation stopped externally at step {step + 1}")
            if audio_streamer is not None:
                audio_streamer.end()
            break

        if finished_tags.all():
            if hasattr(progress_bar, "set_description"):
                progress_bar.set_description("Generation complete")
            break

        cur_input_tts_text_ids = tts_text_ids[
            :,
            tts_text_window_index * TTS_TEXT_WINDOW_SIZE : (tts_text_window_index + 1)
            * TTS_TEXT_WINDOW_SIZE,
        ]
        next_text_window_size = tts_text_ids[
            :,
            (tts_text_window_index + 1)
            * TTS_TEXT_WINDOW_SIZE : (tts_text_window_index + 2)
            * TTS_TEXT_WINDOW_SIZE,
        ].shape[1]
        tts_text_window_index += 1

        if cur_input_tts_text_ids.shape[1] > 0:
            input_ids = torch.cat([input_ids, cur_input_tts_text_ids], dim=-1)
            tts_lm_input_ids = torch.cat([tts_lm_input_ids, cur_input_tts_text_ids], dim=-1)

            if tts_lm_input_ids.shape[1] > tts_lm_generation_config.max_length:
                if verbose:
                    print(
                        f"Reached maximum generation length {generation_config.max_length}, stopped it."
                    )
                reached_samples = torch.arange(batch_size, device=device)[~finished_tags]
                if reached_samples.numel() > 0:
                    reach_max_step_sample[reached_samples] = True
                break

            step += cur_input_tts_text_ids.shape[1]
            total_prefilled_text_tokens += cur_input_tts_text_ids.shape[1]
            if progress_bar is not None:
                progress_bar.update(cur_input_tts_text_ids.shape[1])
                progress_bar.set_description(
                    f"Prefilled {total_prefilled_text_tokens} text tokens, "
                    f"generated {total_generated_speech_tokens} speech tokens, "
                    f"current step ({step} / {tts_lm_generation_config.max_length})"
                )

            model_inputs = self.prepare_inputs_for_generation(input_ids, **model_kwargs)
            outputs = self.forward_lm(
                **model_inputs,
                return_dict=True,
                output_attentions=False,
                output_hidden_states=False,
            )
            model_kwargs = _update_model_kwargs_for_generation(
                outputs, model_kwargs, num_new_tokens=next_text_window_size
            )

            tts_lm_model_inputs = self.prepare_inputs_for_generation(
                tts_lm_input_ids, **tts_lm_model_kwargs
            )
            tts_lm_additional_inputs = {
                "tts_text_masks": torch.ones_like(tts_lm_input_ids[:, -1:]),
                "lm_last_hidden_state": outputs.last_hidden_state,
            }
            tts_lm_outputs = self.forward_tts_lm(
                **tts_lm_model_inputs,
                **tts_lm_additional_inputs,
                return_dict=True,
                output_attentions=False,
                output_hidden_states=False,
            )
            tts_lm_model_kwargs = self._update_model_kwargs_for_generation(
                tts_lm_outputs, tts_lm_model_kwargs, is_encoder_decoder=False
            )

        diffusion_indices = torch.LongTensor([0])

        # ── Inner speech loop ────────────────────────────────────────────────
        for cur_speech_index in range(TTS_SPEECH_WINDOW_SIZE):
            positive_condition = tts_lm_outputs.last_hidden_state[diffusion_indices, -1, :]
            negative_condition = tts_lm_negative_outputs.last_hidden_state[
                diffusion_indices, -1, :
            ]

            speech_latent = self.sample_speech_tokens(
                positive_condition,
                negative_condition,
                cfg_scale=cfg_scale,
            ).unsqueeze(1)

            scaled_latent = (
                speech_latent / self.model.speech_scaling_factor.to(speech_latent.device)
                - self.model.speech_bias_factor.to(speech_latent.device)
            )

            # [VibePod] If a decode executor is configured, submit decode to a
            # background thread so acoustic_connector and forward_tts_lm can run
            # concurrently on the main thread.  The future is resolved after both
            # tts_lm calls complete, before appending/streaming the audio chunk.
            # Without the executor, the original sequential path is used unchanged.
            if _vp_executor is not None:
                _decode_future: concurrent.futures.Future[torch.Tensor] = _vp_executor.submit(
                    self.model.acoustic_tokenizer.decode,
                    scaled_latent.to(self.model.acoustic_tokenizer.device),
                    cache=acoustic_cache,
                    sample_indices=diffusion_indices.to(self.model.acoustic_tokenizer.device),
                    use_cache=True,
                    debug=False,
                )
            else:
                audio_chunk = self.model.acoustic_tokenizer.decode(
                    scaled_latent.to(self.model.acoustic_tokenizer.device),
                    cache=acoustic_cache,
                    sample_indices=diffusion_indices.to(self.model.acoustic_tokenizer.device),
                    use_cache=True,
                    debug=False,
                )

            # [VibePod] connector + tts_lm run here while decode is in the thread.
            acoustic_embed = self.model.acoustic_connector(speech_latent)
            tts_lm_input_ids = torch.cat(
                [tts_lm_input_ids, torch.ones_like(tts_lm_input_ids[:, -1:])], dim=-1
            )

            if tts_lm_input_ids.shape[1] > tts_lm_generation_config.max_length:
                # [VibePod] Resolve before break so audio_chunks stays consistent.
                if _vp_executor is not None:
                    audio_chunk = _decode_future.result()
                for i, sample_idx in enumerate(diffusion_indices):
                    idx = sample_idx.item()
                    if not finished_tags[idx]:
                        audio_chunks[idx].append(audio_chunk[i])
                if audio_streamer is not None:
                    audio_streamer.put(audio_chunk, diffusion_indices)
                break

            step += 1
            total_generated_speech_tokens += 1
            if progress_bar is not None:
                progress_bar.update(1)
                progress_bar.set_description(
                    f"Prefilled {total_prefilled_text_tokens} text tokens, "
                    f"generated {total_generated_speech_tokens} speech tokens, "
                    f"current step ({step} / {tts_lm_generation_config.max_length})"
                )

            tts_lm_model_inputs = self.prepare_inputs_for_generation(
                tts_lm_input_ids, **tts_lm_model_kwargs
            )
            tts_lm_additional_inputs = {
                "tts_text_masks": torch.zeros_like(tts_lm_input_ids[:, -1:]),
                "lm_last_hidden_state": acoustic_embed,
            }
            tts_lm_outputs = self.forward_tts_lm(
                **tts_lm_model_inputs,
                **tts_lm_additional_inputs,
                return_dict=True,
                output_attentions=False,
                output_hidden_states=False,
            )
            if cur_speech_index == TTS_SPEECH_WINDOW_SIZE - 1 and next_text_window_size > 0:
                tts_lm_model_kwargs = _update_model_kwargs_for_generation(
                    tts_lm_outputs, tts_lm_model_kwargs, num_new_tokens=next_text_window_size
                )
            else:
                tts_lm_model_kwargs = self._update_model_kwargs_for_generation(
                    tts_lm_outputs, tts_lm_model_kwargs, is_encoder_decoder=False
                )

            tts_lm_negative_input_ids = torch.cat(
                [tts_lm_negative_input_ids, torch.ones_like(tts_lm_input_ids[:, -1:])], dim=-1
            )
            tts_lm_negative_model_inputs = self.prepare_inputs_for_generation(
                tts_lm_negative_input_ids, **tts_lm_negative_model_kwargs
            )
            tts_lm_negative_additional_inputs = {
                "tts_text_masks": torch.zeros_like(tts_lm_negative_input_ids[:, -1:]),
                "lm_last_hidden_state": acoustic_embed,
            }
            tts_lm_negative_outputs = self.forward_tts_lm(
                **tts_lm_negative_model_inputs,
                **tts_lm_negative_additional_inputs,
                return_dict=True,
                output_attentions=False,
                output_hidden_states=False,
            )
            tts_lm_negative_model_kwargs = self._update_model_kwargs_for_generation(
                tts_lm_negative_outputs,
                tts_lm_negative_model_kwargs,
                is_encoder_decoder=False,
            )

            # [VibePod] Decode is done (or was never async). Resolve future,
            # then append + stream — moved here from before connector/tts_lm.
            if _vp_executor is not None:
                audio_chunk = _decode_future.result()
            for i, sample_idx in enumerate(diffusion_indices):
                idx = sample_idx.item()
                if not finished_tags[idx]:
                    audio_chunks[idx].append(audio_chunk[i])
            if audio_streamer is not None:
                audio_streamer.put(audio_chunk, diffusion_indices)

            tts_eos_logits = torch.sigmoid(
                self.tts_eos_classifier(
                    tts_lm_outputs.last_hidden_state[diffusion_indices, -1, :]
                )
            )
            if tts_eos_logits[0].item() > 0.5:
                finished_tags[diffusion_indices] = True
                if audio_streamer is not None:
                    audio_streamer.end(diffusion_indices)

        if tts_lm_input_ids.shape[1] > tts_lm_generation_config.max_length:
            if verbose:
                print(
                    f"Reached maximum generation length {tts_lm_generation_config.max_length}, stopped it."
                )
            reached_samples = torch.arange(batch_size, device=device)[~finished_tags]
            if reached_samples.numel() > 0:
                reach_max_step_sample[reached_samples] = True
            break

    if audio_streamer is not None:
        audio_streamer.end()

    # ── Audio finalisation (unchanged from original) ─────────────────────────
    final_audio_outputs = []
    for sample_chunks in audio_chunks:
        if sample_chunks:
            concatenated_audio = torch.cat(sample_chunks, dim=-1)
            final_audio_outputs.append(concatenated_audio)
        else:
            final_audio_outputs.append(None)

    if reach_max_step_sample is not None and reach_max_step_sample.any():
        print(
            f"Reached maximum generation length {tts_lm_generation_config.max_length}, stopped it."
        )

    return VibeVoiceGenerationOutput(
        sequences=tts_lm_input_ids,
        speech_outputs=final_audio_outputs if return_speech else None,
        reach_max_step_sample=reach_max_step_sample,
    )


def install(model: object, executor: concurrent.futures.ThreadPoolExecutor) -> None:
    """Install the patched generate() on a model instance and attach the executor."""
    model._vibepod_decode_executor = executor
    model.generate = types.MethodType(patched_generate, model)
