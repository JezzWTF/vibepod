"use client";

import { useEffect, useRef, useState } from "react";
import type { GenerationJob, WaveformPeaks } from "@/lib/types/generation";
import WaveformPreview from "./WaveformPreview";

interface GenerationCardProps {
  job: GenerationJob;
  onDelete: (id: string) => void;
}

function formatDuration(secs: number | null): string {
  if (secs === null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export default function GenerationCard({ job, onDelete }: GenerationCardProps) {
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (job.status !== "complete" || !job.waveform_path) return;
    fetch(`/api/generations/${job.id}/waveform`)
      .then((r) => r.json())
      .then((data: WaveformPeaks) => setPeaks(data))
      .catch(() => {});
  }, [job.id, job.status, job.waveform_path]);

  function handlePlayPause() {
    if (!audioRef.current) {
      audioRef.current = new Audio(`/api/generations/${job.id}/audio`);
      audioRef.current.onended = () => setIsPlaying(false);
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this generation?")) return;
    setIsDeleting(true);
    try {
      await fetch(`/api/generations/${job.id}`, { method: "DELETE" });
      onDelete(job.id);
    } catch {
      setIsDeleting(false);
    }
  }

  const isComplete = job.status === "complete";

  const statusColors: Record<string, string> = {
    complete: "var(--success)",
    generating: "var(--status-loading)",
    error: "var(--error)",
    cancelled: "var(--muted)",
  };

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{ background: "var(--card-bg)", borderColor: "var(--border)" }}
    >
      {/* Waveform or placeholder */}
      <div
        className="rounded-lg overflow-hidden flex items-center justify-center"
        style={{ background: "var(--background)", minHeight: 48 }}
      >
        {peaks ? (
          <WaveformPreview peaks={peaks} height={48} className="px-2" />
        ) : (
          <div className="w-full h-12 flex items-center justify-center">
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {job.status === "generating" ? "Generating…" : "No waveform"}
            </span>
          </div>
        )}
      </div>

      {/* Script preview */}
      <p className="text-sm leading-snug" style={{ color: "var(--foreground)" }}>
        {truncate(job.script, 120)}
      </p>

      {/* Metadata row */}
      <div className="flex flex-wrap gap-2 items-center">
        <span
          className="px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide"
          style={{
            background: "var(--accent-teal-dim)",
            color: "var(--accent-teal)",
          }}
        >
          {job.speaker}
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {formatDuration(job.duration_secs)}
        </span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          CFG {job.cfg_scale}
        </span>
        <span
          className="ml-auto text-xs font-medium"
          style={{ color: statusColors[job.status] ?? "var(--muted)" }}
        >
          {job.status}
        </span>
      </div>

      {/* Date */}
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {formatDate(job.created_at)}
      </p>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {isComplete && (
          <>
            <button
              onClick={handlePlayPause}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{
                background: isPlaying ? "var(--accent-teal-dim)" : "transparent",
                borderColor: "var(--accent-teal-dim)",
                color: "var(--accent-teal)",
              }}
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <a
              href={`/api/generations/${job.id}/audio`}
              download={`${job.id}.wav`}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border text-center transition-colors"
              style={{
                background: "transparent",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            >
              ↓ Download
            </a>
          </>
        )}
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50"
          style={{
            background: "transparent",
            borderColor: "var(--error)",
            color: "var(--error)",
          }}
        >
          {isDeleting ? "…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
