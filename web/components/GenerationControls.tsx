"use client";

import { useState } from "react";
import type { ServerStatus, DownloadProgress } from "@/app/page";

const FALLBACK_VOICES = ["carter", "davis", "emma", "frank", "grace", "mike"];

interface GenerationControlsProps {
  speaker: string;
  availableVoices: string[];
  onSpeakerChange: (v: string) => void;
  cfgScale: number;
  onCfgScaleChange: (v: number) => void;
  inferenceSteps: number;
  onInferenceStepsChange: (v: number) => void;
  prebufferSecs: number;
  onPrebufferSecsChange: (v: number) => void;
  rebufferThresholdSecs: number;
  onRebufferThresholdChange: (v: number) => void;
  resumeThresholdSecs: number;
  onResumeThresholdChange: (v: number) => void;
  onGenerate: () => void;
  onStop: () => void;
  onPauseStream: () => void;
  onResumeStream: () => void;
  isStreamPaused: boolean;
  isGenerating: boolean;
  genElapsed: number;
  genPct: number | null;
  wordCount: number;
  serverStatus: ServerStatus;
  downloadProgress: DownloadProgress | null;
}

const STATUS_CONFIG: Record<
  Exclude<ServerStatus, "online">,
  { color: string; label: (p: DownloadProgress | null) => string }
> = {
  offline:     { color: "var(--error)",   label: () => "Server offline — waiting for connection..." },
  downloading: { color: "#60a5fa",        label: (p) => p && p.total > 0 ? `Downloading model... (${p.done} / ${p.total} files)` : "Downloading model (~1 GB)..." },
  loading:     { color: "#fbbf24",        label: () => "Loading model into memory..." },
  error:       { color: "var(--error)",   label: () => "Server error — check the terminal for details." },
};


function SpinnerIcon() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function GenerationControls({
  speaker,
  availableVoices,
  onSpeakerChange,
  cfgScale,
  onCfgScaleChange,
  inferenceSteps,
  onInferenceStepsChange,
  prebufferSecs,
  onPrebufferSecsChange,
  rebufferThresholdSecs,
  onRebufferThresholdChange,
  resumeThresholdSecs,
  onResumeThresholdChange,
  onGenerate,
  onStop,
  onPauseStream,
  onResumeStream,
  isStreamPaused,
  isGenerating,
  genElapsed,
  genPct,
  wordCount,
  serverStatus,
  downloadProgress,
}: GenerationControlsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const voices = availableVoices.length > 0 ? availableVoices : FALLBACK_VOICES;
  const serverReady = serverStatus === "online";
  const buttonDisabled = isGenerating || wordCount === 0 || !serverReady;

  const downloadPct =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.done / downloadProgress.total) * 100)
      : 0;

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-5"
      style={{ background: "var(--card-bg)", borderColor: "var(--border)" }}
    >
      <h2
        className="text-sm font-semibold uppercase tracking-wider"
        style={{ color: "var(--accent-teal)" }}
      >
        Generation Settings
      </h2>

      {/* Voice selector */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
          Voice
        </label>
        <select
          value={speaker}
          onChange={(e) => onSpeakerChange(e.target.value)}
          disabled={!serverReady}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium appearance-none cursor-pointer disabled:cursor-not-allowed"
          style={{
            background: "var(--background)",
            border: "1px solid var(--border)",
            color: serverReady ? "var(--foreground)" : "var(--muted)",
          }}
        >
          {voices.map((v) => (
            <option key={v} value={v}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* CFG Scale slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
            Voice Expressiveness
          </label>
          <span
            className="text-sm font-mono px-2 py-0.5 rounded"
            style={{ background: "var(--background)", color: "var(--accent-teal)" }}
          >
            {cfgScale.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0.5}
          max={4.0}
          step={0.1}
          value={cfgScale}
          onChange={(e) => onCfgScaleChange(parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
          <span>Flat (0.5)</span>
          <span>CFG Scale</span>
          <span>Expressive (4.0)</span>
        </div>
      </div>

      {/* Inference Steps slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
            Quality vs Speed
          </label>
          <span
            className="text-sm font-mono px-2 py-0.5 rounded"
            style={{ background: "var(--background)", color: "var(--accent-violet)" }}
          >
            {inferenceSteps}
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={20}
          step={1}
          value={inferenceSteps}
          onChange={(e) => onInferenceStepsChange(parseInt(e.target.value, 10))}
          className="w-full"
          style={{ "--thumb-color": "var(--accent-violet)" } as React.CSSProperties}
        />
        <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
          <span>Faster (5)</span>
          <span>Diffusion Steps</span>
          <span>Better (20)</span>
        </div>
      </div>

      {/* Advanced Buffering toggle */}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          aria-controls="advanced-buffering-panel"
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider cursor-pointer transition-colors"
          style={{ color: showAdvanced ? "var(--accent-teal)" : "var(--muted)" }}
        >
          <svg
            className={`w-3 h-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Advanced Buffering
        </button>
      </div>

      {showAdvanced && (
        <div id="advanced-buffering-panel" className="flex flex-col gap-4 pl-2 border-l" style={{ borderColor: "var(--border)" }}>
          {/* Pre-buffer */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                Initial Pre-buffer
              </label>
              <span className="text-xs font-mono" style={{ color: "var(--accent-teal)" }}>
                {prebufferSecs.toFixed(1)}s
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={10.0}
              step={0.5}
              value={prebufferSecs}
              onChange={(e) => onPrebufferSecsChange(parseFloat(e.target.value))}
              className="w-full h-1"
            />
          </div>

          {/* Re-buffer threshold */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="rebuffer-threshold" className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                Re-buffer Threshold
              </label>
              <span className="text-xs font-mono" style={{ color: "var(--accent-teal)" }}>
                {rebufferThresholdSecs.toFixed(1)}s
              </span>
            </div>
            <input
              id="rebuffer-threshold"
              type="range"
              min={0.1}
              max={3.0}
              step={0.1}
              value={rebufferThresholdSecs}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                onRebufferThresholdChange(next);
                if (resumeThresholdSecs <= next) {
                  onResumeThresholdChange(parseFloat((next + 0.5).toFixed(1)));
                }
              }}
              className="w-full h-1"
            />
          </div>

          {/* Resume threshold */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="resume-threshold" className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                Resume Threshold
              </label>
              <span className="text-xs font-mono" style={{ color: "var(--accent-teal)" }}>
                {resumeThresholdSecs.toFixed(1)}s
              </span>
            </div>
            <input
              id="resume-threshold"
              type="range"
              min={0.5}
              max={5.0}
              step={0.1}
              value={resumeThresholdSecs}
              onChange={(e) => {
                const next = parseFloat(e.target.value);
                if (next <= rebufferThresholdSecs) return;
                onResumeThresholdChange(next);
              }}
              className="w-full h-1"
            />
          </div>
        </div>
      )}

      {/* Server status banner */}
      {!serverReady && (
        <div
          className="flex flex-col gap-2 px-3 py-3 rounded-lg text-sm"
          style={{ background: "var(--background)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${serverStatus === "offline" || serverStatus === "error" ? "" : "animate-pulse"}`}
              style={{ background: STATUS_CONFIG[serverStatus].color }}
            />
            <span style={{ color: STATUS_CONFIG[serverStatus].color }}>
              {STATUS_CONFIG[serverStatus].label(downloadProgress)}
            </span>
          </div>

          {serverStatus === "downloading" && (
            <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${downloadPct}%`,
                  background: "linear-gradient(90deg, #60a5fa, var(--accent-teal))",
                  minWidth: downloadPct > 0 ? "4px" : "0",
                }}
              />
            </div>
          )}

          {serverStatus === "loading" && (
            <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
              <div
                className="h-1.5 rounded-full animate-pulse"
                style={{ width: "60%", background: "linear-gradient(90deg, #fbbf24, var(--accent-teal))" }}
              />
            </div>
          )}
        </div>
      )}

      {/* Generation progress bar */}
      {isGenerating && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>{genElapsed}s elapsed</span>
            <span>{genPct !== null ? `${genPct}%` : "starting..."}</span>
          </div>
          <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: "var(--border)" }}>
            <div
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: genPct !== null ? `${genPct}%` : "0%",
                background: "linear-gradient(90deg, var(--accent-teal), var(--accent-violet))",
                minWidth: genPct !== null && genPct > 0 ? "4px" : "0",
              }}
            />
          </div>
        </div>
      )}

      {/* Generate / Stop buttons */}
      <div className="flex gap-2">
        <button
          onClick={onGenerate}
          disabled={buttonDisabled}
          className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
          style={
            buttonDisabled
              ? { background: "var(--border)", color: "var(--muted)" }
              : {
                  background: "linear-gradient(135deg, var(--accent-teal-dim), var(--accent-violet-dim))",
                  color: "#fff",
                  boxShadow: "0 4px 15px rgba(45, 212, 191, 0.2)",
                }
          }
        >
          {isGenerating ? (
            <>
              <SpinnerIcon />
              Generating...
            </>
          ) : !serverReady ? (
            <>
              <SpinnerIcon />
              {serverStatus === "downloading" ? "Downloading model..." : "Waiting for server..."}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Generate Audio
            </>
          )}
        </button>

        {isGenerating && (
          <>
            <button
              onClick={isStreamPaused ? onResumeStream : onPauseStream}
              className="px-4 py-3 rounded-xl font-semibold text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
              style={{
                background: "var(--background)",
                border: `1px solid ${isStreamPaused ? "var(--accent-teal)" : "#fbbf24"}`,
                color: isStreamPaused ? "var(--accent-teal)" : "#fbbf24",
              }}
            >
              {isStreamPaused ? (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Resume
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  Pause
                </>
              )}
            </button>

            <button
              onClick={onStop}
              className="px-4 py-3 rounded-xl font-semibold text-sm transition-all cursor-pointer flex items-center justify-center gap-1.5"
              style={{
                background: "var(--background)",
                border: "1px solid var(--error)",
                color: "var(--error)",
              }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
