"use client";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useEffect } from "react";

const clock = (seconds: number) =>
  `${Math.floor((seconds || 0) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds || 0) % 60)
    .toString()
    .padStart(2, "0")}`;
export default function StudioTransport({
  src,
  title,
  onStart,
  ready,
  onPlay,
  stopSignal,
}: {
  src: string | null;
  title: string;
  onStart?: number;
  ready: boolean;
  onPlay: () => void;
  stopSignal: number;
}) {
  const player = useAudioPlayer(src);
  useEffect(() => {
    player.pause();
  }, [stopSignal, player.pause]);
  return (
    <footer className="studio-transport">
      <div>
        <strong>{title}</strong>
        <span role={player.error ? "alert" : undefined}>
          {player.error ||
            (ready
              ? "Episode playback · selected takes"
              : "Select a completed take for every block to play the episode")}
        </span>
        {ready && (
          <button
            onClick={() => {
              onPlay();
              player.playFrom(onStart ?? 0);
            }}
          >
            Play from selected block
          </button>
        )}
      </div>
      <button
        className="transport-play"
        disabled={!ready}
        onClick={() => {
          onPlay();
          player.toggle();
        }}
        aria-label={player.isPlaying ? "Pause episode" : "Play episode"}
      >
        {player.isPlaying ? "Ⅱ" : "▶"}
      </button>
      <time>{clock(player.currentTime)}</time>
      <input
        aria-label="Episode position"
        type="range"
        min={0}
        max={player.duration || 1}
        step={0.1}
        value={player.currentTime}
        disabled={!ready}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      <time>{clock(player.duration)}</time>
      <label className="transport-volume">
        Volume
        <input
          aria-label="Episode volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={player.volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
        />
      </label>
    </footer>
  );
}
