"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildWav, decodeFloat32Chunk, mergeFloat32Arrays, SAMPLE_RATE } from "@/lib/audio/wav";

const DEFAULT_PREBUFFER_SECS = 5.0;
const DEFAULT_REBUFFER_THRESHOLD_SECS = 1.0;
const DEFAULT_RESUME_THRESHOLD_SECS = 3.0;
const MAX_ADAPTIVE_RESUME_SECS = 30.0;

interface GenerateOptions {
  text: string;
  speaker: string;
  cfgScale: number;
  inferenceSteps: number;
}

interface UseStreamingGenerationOptions {
  onLog: (message: string) => void;
  onStart: () => void;
  onProgress: (elapsed: number, pct: number | null) => void;
  onSuccess: (audioUrl: string) => void;
  onCancel: () => void;
  onError: () => void;
  /** Seconds of audio to buffer before playback starts. */
  prebufferSecs?: number;
  /** Buffer lookahead (seconds) below which playback suspends to refill. */
  rebufferThresholdSecs?: number;
  /** Buffer lookahead (seconds) at or above which suspended playback resumes. Must be > rebufferThresholdSecs. */
  resumeThresholdSecs?: number;
}

export function useStreamingGeneration({
  onLog,
  onStart,
  onProgress,
  onSuccess,
  onCancel,
  onError,
  prebufferSecs = DEFAULT_PREBUFFER_SECS,
  rebufferThresholdSecs: rawRebufferThresholdSecs = DEFAULT_REBUFFER_THRESHOLD_SECS,
  resumeThresholdSecs: rawResumeThresholdSecs = DEFAULT_RESUME_THRESHOLD_SECS,
}: UseStreamingGenerationOptions) {
  let rebufferThresholdSecs = rawRebufferThresholdSecs;
  let resumeThresholdSecs = rawResumeThresholdSecs;
  if (resumeThresholdSecs <= rebufferThresholdSecs) {
    console.warn(
      `[useStreamingGeneration] resumeThresholdSecs (${resumeThresholdSecs}) must be greater than rebufferThresholdSecs (${rebufferThresholdSecs}). Clamping resumeThresholdSecs to ${rebufferThresholdSecs + 0.5}.`
    );
    resumeThresholdSecs = rebufferThresholdSecs + 0.5;
  }
  const [isStreamPaused, setIsStreamPaused] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const chunksRef = useRef<Float32Array<ArrayBuffer>[]>([]);
  const hasStartedPlaybackRef = useRef(false);
  const isAutoBufferingRef = useRef(false);
  const isUserPausedRef = useRef(false);
  const audioUrlRef = useRef<string | null>(null);
  const firstChunkSeenRef = useRef(false);
  const underrunCountRef = useRef(0);
  const totalAudioSamplesRef = useRef(0);
  const adaptiveResumeSecsRef = useRef(DEFAULT_RESUME_THRESHOLD_SECS);

  const revokeCurrentUrl = useCallback(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const resetPlayback = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    nextStartTimeRef.current = 0;
    chunksRef.current = [];
    hasStartedPlaybackRef.current = false;
    isAutoBufferingRef.current = false;
    isUserPausedRef.current = false;
    firstChunkSeenRef.current = false;
    underrunCountRef.current = 0;
    totalAudioSamplesRef.current = 0;
    adaptiveResumeSecsRef.current = resumeThresholdSecs;
    setIsStreamPaused(false);
  }, [resumeThresholdSecs]);

  useEffect(() => {
    return () => {
      resetPlayback();
      revokeCurrentUrl();
    };
  }, [resetPlayback, revokeCurrentUrl]);

  const enqueue = useCallback((ctx: AudioContext, chunk: Float32Array<ArrayBuffer>) => {
    const audioBuffer = ctx.createBuffer(1, chunk.length, SAMPLE_RATE);
    audioBuffer.copyToChannel(chunk, 0);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    const startAt = Math.max(nextStartTimeRef.current, ctx.currentTime + 0.05);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;
  }, []);

  const flushBufferedAudio = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || chunksRef.current.length === 0) return;
    nextStartTimeRef.current = ctx.currentTime + 0.1;
    for (const chunk of chunksRef.current) {
      enqueue(ctx, chunk);
    }
    hasStartedPlaybackRef.current = true;
  }, [enqueue]);

  const handleAudioChunk = useCallback(
    (chunk: Float32Array<ArrayBuffer>) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return;

      chunksRef.current.push(chunk);
      totalAudioSamplesRef.current += chunk.length;

      if (!firstChunkSeenRef.current) {
        firstChunkSeenRef.current = true;
        onLog("First audio chunk received");
      }

      if (!hasStartedPlaybackRef.current) {
        const bufferedSecs = chunksRef.current.reduce((sum, c) => sum + c.length, 0) / SAMPLE_RATE;
        if (bufferedSecs >= prebufferSecs) {
          onLog(`Playback started after ${bufferedSecs.toFixed(1)}s buffered`);
          flushBufferedAudio();
        }
        return;
      }

      enqueue(ctx, chunk);
      if (isUserPausedRef.current) return;

      const ahead = nextStartTimeRef.current - ctx.currentTime;
      if (ctx.state === "running" && !isAutoBufferingRef.current && ahead < rebufferThresholdSecs) {
        isAutoBufferingRef.current = true;
        underrunCountRef.current += 1;
        adaptiveResumeSecsRef.current = Math.min(
          MAX_ADAPTIVE_RESUME_SECS,
          Math.max(resumeThresholdSecs, prebufferSecs + underrunCountRef.current * 2)
        );
        ctx.suspend().catch(() => {});
        onLog(
          `Buffer underrun ${underrunCountRef.current}; refilling to ${adaptiveResumeSecsRef.current.toFixed(1)}s`
        );
      } else if (isAutoBufferingRef.current && ahead >= adaptiveResumeSecsRef.current) {
        isAutoBufferingRef.current = false;
        ctx.resume().catch(() => {});
        onLog(`Buffer recovered with ${ahead.toFixed(1)}s queued`);
      }
    },
    [enqueue, flushBufferedAudio, onLog, prebufferSecs, rebufferThresholdSecs, resumeThresholdSecs]
  );

  const generate = useCallback(
    async (options: GenerateOptions) => {
      if (!options.text.trim()) return;

      resetPlayback();
      revokeCurrentUrl();
      audioCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE });

      const controller = new AbortController();
      abortRef.current = controller;

      onStart();
      onLog(`Voice: ${options.speaker}`);
      onLog(`CFG ${options.cfgScale.toFixed(1)}, steps ${options.inferenceSteps}`);

      const startedAt = Date.now();
      const timerId = window.setInterval(() => {
        onProgress((Date.now() - startedAt) / 1000, null);
      }, 500);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: options.text,
            speaker: options.speaker,
            cfg_scale: options.cfgScale,
            inference_steps: options.inferenceSteps,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6)) as {
              type: "audio_chunk" | "complete" | "error" | "cancelled";
              data?: string;
              elapsed?: number;
              audio_secs?: number;
              realtime_factor?: number | null;
              chunks?: number;
              first_chunk_secs?: number | null;
              max_chunk_gap_secs?: number;
              message?: string;
            };

            if (event.type === "audio_chunk" && event.data) {
              handleAudioChunk(decodeFloat32Chunk(event.data));
            } else if (event.type === "complete") {
              if (!hasStartedPlaybackRef.current) {
                flushBufferedAudio();
              } else if (isAutoBufferingRef.current) {
                isAutoBufferingRef.current = false;
                audioCtxRef.current?.resume().catch(() => {});
              }
              const wavBlob = buildWav(mergeFloat32Arrays(chunksRef.current), SAMPLE_RATE);
              const audioUrl = URL.createObjectURL(wavBlob);
              audioUrlRef.current = audioUrl;
              const kb = (wavBlob.size / 1024).toFixed(0);
              const audioSecs = event.audio_secs ?? totalAudioSamplesRef.current / SAMPLE_RATE;
              const realtimeFactor =
                event.realtime_factor ??
                (event.elapsed && event.elapsed > 0 ? audioSecs / event.elapsed : null);
              const speedText =
                realtimeFactor === null ? "" : ` - ${realtimeFactor.toFixed(2)}x realtime`;
              onLog(
                `Done in ${event.elapsed}s - ${audioSecs.toFixed(1)}s audio${speedText} - ${kb} KB`
              );
              if (event.chunks && event.first_chunk_secs !== undefined) {
                onLog(
                  `Stream: first chunk ${event.first_chunk_secs}s, ${event.chunks} chunks, max gap ${event.max_chunk_gap_secs}s`
                );
              }
              onSuccess(audioUrl);
            } else if (event.type === "cancelled") {
              throw new DOMException("Generation cancelled", "AbortError");
            } else if (event.type === "error") {
              throw new Error(event.message ?? "Generation failed");
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          onLog("Cancelled.");
          onCancel();
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          onLog(`Error: ${message}`);
          onError();
        }
      } finally {
        window.clearInterval(timerId);
        abortRef.current = null;
      }
    },
    [
      flushBufferedAudio,
      handleAudioChunk,
      onCancel,
      onError,
      onLog,
      onProgress,
      onStart,
      onSuccess,
      resetPlayback,
      revokeCurrentUrl,
    ]
  );

  const pauseStream = useCallback(() => {
    isUserPausedRef.current = true;
    audioCtxRef.current?.suspend().catch(() => {});
    setIsStreamPaused(true);
  }, []);

  const resumeStream = useCallback(() => {
    isUserPausedRef.current = false;
    isAutoBufferingRef.current = false;
    audioCtxRef.current?.resume().catch(() => {});
    setIsStreamPaused(false);
  }, []);

  const stop = useCallback(() => {
    resetPlayback();
  }, [resetPlayback]);

  return {
    generate,
    pauseStream,
    resumeStream,
    stop,
    isStreamPaused,
  };
}
