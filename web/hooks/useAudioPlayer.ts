"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AudioPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export function useAudioPlayer(audioUrl: string | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
  });

  // Create/replace the Audio element whenever the URL changes
  useEffect(() => {
    if (!audioUrl) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setState({ isPlaying: false, currentTime: 0, duration: 0, volume: 1 });
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const controller = new AbortController();
    const { signal } = controller;

    audio.addEventListener("timeupdate", () => setState((prev) => ({ ...prev, currentTime: audio.currentTime })), { signal });
    audio.addEventListener("durationchange", () => setState((prev) => ({ ...prev, duration: audio.duration })), { signal });
    audio.addEventListener("loadedmetadata", () => setState((prev) => ({ ...prev, duration: audio.duration })), { signal });
    audio.addEventListener("ended", () => setState((prev) => ({ ...prev, isPlaying: false, currentTime: 0 })), { signal });
    audio.addEventListener("play", () => setState((prev) => ({ ...prev, isPlaying: true })), { signal });
    audio.addEventListener("pause", () => setState((prev) => ({ ...prev, isPlaying: false })), { signal });

    return () => {
      audio.pause();
      controller.abort();
    };
  }, [audioUrl]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, audio.duration));
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
    seek,
    setVolume,
  };
}
