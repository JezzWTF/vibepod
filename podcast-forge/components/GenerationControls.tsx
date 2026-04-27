"use client";

interface GenerationControlsProps {
  cfgScale: number;
  onCfgScaleChange: (v: number) => void;
  inferenceSteps: number;
  onInferenceStepsChange: (v: number) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  wordCount: number;
}

export default function GenerationControls({
  cfgScale,
  onCfgScaleChange,
  inferenceSteps,
  onInferenceStepsChange,
  onGenerate,
  isGenerating,
  wordCount,
}: GenerationControlsProps) {
  const estimatedSeconds = Math.ceil(wordCount / 50);
  const estimatedDisplay =
    wordCount === 0
      ? "—"
      : estimatedSeconds < 60
        ? `~${estimatedSeconds}s`
        : `~${Math.floor(estimatedSeconds / 60)}m ${estimatedSeconds % 60}s`;

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

      {/* CFG Scale slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
            Voice Expressiveness
          </label>
          <span
            className="text-sm font-mono px-2 py-0.5 rounded"
            style={{
              background: "var(--background)",
              color: "var(--accent-teal)",
            }}
          >
            {cfgScale.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={1.0}
          max={3.0}
          step={0.1}
          value={cfgScale}
          onChange={(e) => onCfgScaleChange(parseFloat(e.target.value))}
          className="w-full"
        />
        <div
          className="flex items-center justify-between text-xs"
          style={{ color: "var(--muted)" }}
        >
          <span>Flat (1.0)</span>
          <span>CFG Scale</span>
          <span>Expressive (3.0)</span>
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
            style={{
              background: "var(--background)",
              color: "var(--accent-violet)",
            }}
          >
            {inferenceSteps}
          </span>
        </div>
        <input
          type="range"
          min={10}
          max={30}
          step={1}
          value={inferenceSteps}
          onChange={(e) => onInferenceStepsChange(parseInt(e.target.value, 10))}
          className="w-full"
          style={
            {
              "--thumb-color": "var(--accent-violet)",
            } as React.CSSProperties
          }
        />
        <div
          className="flex items-center justify-between text-xs"
          style={{ color: "var(--muted)" }}
        >
          <span>Faster (10)</span>
          <span>Inference Steps</span>
          <span>Higher quality (30)</span>
        </div>
      </div>

      {/* Estimated time */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--muted)" }}>Estimated generation time</span>
        <span
          className="font-mono font-medium"
          style={{ color: "var(--accent-teal)" }}
        >
          {estimatedDisplay}
        </span>
      </div>

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isGenerating || wordCount === 0}
        className="w-full py-3 rounded-xl font-semibold text-sm transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={
          isGenerating || wordCount === 0
            ? {
                background: "var(--border)",
                color: "var(--muted)",
              }
            : {
                background:
                  "linear-gradient(135deg, var(--accent-teal-dim), var(--accent-violet-dim))",
                color: "#fff",
                boxShadow: "0 4px 15px rgba(45, 212, 191, 0.2)",
              }
        }
      >
        {isGenerating ? (
          <>
            <svg
              className="animate-spin w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Generating audio...
          </>
        ) : (
          <>
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Generate Podcast Audio
          </>
        )}
      </button>
    </div>
  );
}
