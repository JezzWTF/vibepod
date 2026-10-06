"use client";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useEffect, useState } from "react";

type Playlist = {
  src: string | null;
  readyCount: number;
  totalCount: number;
  duration: number;
  startOffsets: Record<string, number>;
};

const clock = (seconds: number) =>
  `${Math.floor((seconds || 0) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds || 0) % 60)
    .toString()
    .padStart(2, "0")}`;
export default function StudioTransport({
  playlist,
  title,
  selectedBlockId,
  onPlay,
  stopSignal,
}: {
  playlist: Playlist;
  title: string;
  selectedBlockId: string | null;
  onPlay: () => void;
  stopSignal: number;
}) {
  const [snapshot, setSnapshot] = useState(playlist);
  const player = useAudioPlayer(snapshot.src);
  // Finishing takes must not interrupt a preview already playing.
  // Pausing or ending refreshes the next playback from current selections.
  useEffect(() => {
    if (!player.isPlaying) setSnapshot(playlist);
  }, [playlist.src, playlist.readyCount, playlist.totalCount, player.isPlaying]);
  const ready = snapshot.readyCount > 0;
  const partial = snapshot.readyCount < snapshot.totalCount;
  const onStart = selectedBlockId ? snapshot.startOffsets[selectedBlockId] : undefined;
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
              ? partial
                ? `Preview · ${snapshot.readyCount}/${snapshot.totalCount} lines ready · ${snapshot.totalCount - snapshot.readyCount} skipped`
                : "Episode playback · selected takes"
              : "Generate and select a take to preview the episode")}
        </span>
        {ready && (
          <button
            disabled={onStart === undefined}
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
        aria-label={
          player.isPlaying
            ? partial
              ? "Pause preview"
              : "Pause episode"
            : partial
              ? "Play preview"
              : "Play episode"
        }
      >
        {player.isPlaying ? "Ⅱ" : "▶"}
      </button>
      <time>{clock(player.currentTime)}</time>
      <input
        aria-label={partial ? "Preview position" : "Episode position"}
        type="range"
        min={0}
        max={player.duration || snapshot.duration || 1}
        step={0.1}
        value={player.currentTime}
        disabled={!ready}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      <time>{clock(player.duration || snapshot.duration)}</time>
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
