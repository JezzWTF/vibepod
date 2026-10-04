"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error: string;
}

export function useAudioPlayer(audioUrl: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    error: "",
  });

  // Create/replace the Audio element whenever the URL changes
  useEffect(() => {
    if (!audioUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setState({ isPlaying: false, currentTime: 0, duration: 0, volume: 1, error: "" });
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0, duration: 0, error: "" }));
    audio.volume = state.volume;

    const controller = new AbortController();
    const { signal } = controller;
    audio.addEventListener(
      "error",
      () =>
        setState((prev) => ({
          ...prev,
          isPlaying: false,
          error: "Audio could not be loaded. Try again.",
        })),
      { signal }
    );

    audio.addEventListener(
      "timeupdate",
      () => setState((prev) => ({ ...prev, currentTime: audio.currentTime })),
      { signal }
    );
    audio.addEventListener(
      "durationchange",
      () => setState((prev) => ({ ...prev, duration: audio.duration })),
      { signal }
    );
    audio.addEventListener(
      "loadedmetadata",
      () => setState((prev) => ({ ...prev, duration: audio.duration })),
      { signal }
    );
    audio.addEventListener(
      "ended",
      () => setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 })),
      { signal }
    );
    audio.addEventListener("play", () => setState((prev) => ({ ...prev, isPlaying: true })), {
      signal,
    });
    audio.addEventListener("pause", () => setState((prev) => ({ ...prev, isPlaying: false })), {
      signal,
    });

    return () => {
      audio.pause();
      controller.abort();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [audioUrl]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .catch(() =>
          setState((prev) => ({ ...prev, error: "Playback could not start. Try again." }))
        );
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(time, Number.isFinite(audio.duration) ? audio.duration : time)
    );
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const playFrom = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const start = () => {
      if (audioRef.current !== audio) return;
      audio.currentTime = time;
      audio
        .play()
        .catch(() =>
          setState((prev) => ({ ...prev, error: "Playback could not start. Try again." }))
        );
    };
    if (audio.readyState >= 1) start();
    else audio.addEventListener("loadedmetadata", start, { once: true });
  }, []);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, v));
    setState((prev) => ({ ...prev, volume: v }));
  }, []);

  return {
    isPlaying: state.isPlaying,
    currentTime: state.currentTime,
    duration: state.duration,
    volume: state.volume,
    toggle,
    pause,
    seek,
    setVolume,
    playFrom,
    error: state.error,
  };
}
