"use client";

import { useAudioPlayer } from "@/hooks/useAudioPlayer";

interface AudioPlayerProps {
  audioUrl: string | null;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({ audioUrl }: AudioPlayerProps) {
  const { isPlaying, currentTime, duration, volume, toggle, seek, setVolume } =
    useAudioPlayer(audioUrl);

  if (!audioUrl) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "vibepod-output.wav";
    a.click();
  };

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-4"
      style={{ background: "var(--card-bg)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center justify-between">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--accent-teal)" }}
        >
          Audio Player
        </h2>
        <button
          onClick={handleDownload}
          className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer"
          style={{
            borderColor: "var(--accent-teal-dim)",
            color: "var(--accent-teal)",
            background: "rgba(45, 212, 191, 0.05)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(45, 212, 191, 0.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(45, 212, 191, 0.05)";
          }}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download WAV
        </button>
      </div>

      {/* Waveform / progress bar */}
      <div className="flex flex-col gap-2">
        <div
          className="relative h-2 rounded-full cursor-pointer overflow-hidden"
          style={{ background: "var(--border)" }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(ratio * duration);
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all"
            style={{
              width: `${progress}%`,
              background:
                "linear-gradient(90deg, var(--accent-teal-dim), var(--accent-violet-dim))",
            }}
          />
        </div>
        <div
          className="flex items-center justify-between text-xs font-mono"
          style={{ color: "var(--muted)" }}
        >
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4">
        {/* Play/Pause */}
        <button
          onClick={toggle}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
          style={{
            background: "linear-gradient(135deg, var(--accent-teal-dim), var(--accent-violet-dim))",
            boxShadow: "0 4px 12px rgba(45, 212, 191, 0.3)",
          }}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>

        {/* Duration info */}
        <div className="flex-1 flex items-center gap-1 text-sm">
          <span style={{ color: "var(--foreground)" }}>{formatTime(currentTime)}</span>
          <span style={{ color: "var(--muted)" }}>/</span>
          <span style={{ color: "var(--muted)" }}>{formatTime(duration)}</span>
        </div>

        {/* Volume control */}
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 flex-shrink-0"
            style={{ color: "var(--muted)" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {volume === 0 ? (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </>
            ) : volume < 0.5 ? (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 010 7.07" />
              </>
            ) : (
              <>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
              </>
            )}
          </svg>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-20"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
  );
}
