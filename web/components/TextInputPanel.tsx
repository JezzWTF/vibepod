"use client";

const SAMPLE_SCRIPT = `Welcome to VibePod, your gateway to the future of audio content creation. Today, we're diving deep into the world of artificial intelligence and how it's transforming the way we produce and consume podcasts.

Imagine being able to transform any written article, blog post, or essay into a professional-sounding audio experience in just seconds. That's exactly what VibeVoice 0.5B brings to the table — a compact yet powerful text-to-speech model that delivers remarkably natural-sounding voices.

The technology behind modern TTS systems has evolved dramatically over the past few years. We've moved from robotic, stilted speech synthesis to voices that carry real emotional nuance and natural prosody. VibeVoice represents Microsoft's latest contribution to this rapidly advancing field.

Whether you're a content creator looking to repurpose written material, an educator who wants to make content more accessible, or a developer building the next generation of audio applications, VibePod provides the tools you need.

In today's episode, we'll explore the key features that make VibeVoice unique, discuss practical use cases across different industries, and look ahead to what the next generation of voice AI might bring. Let's get started.`;

interface TextInputPanelProps {
  value: string;
  onChange: (text: string) => void;
}

export default function TextInputPanel({ value, onChange }: TextInputPanelProps) {
  const charCount = value.length;
  const wordCount = value.trim() === "" ? 0 : value.trim().split(/\s+/).length;

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
          Podcast Script
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onChange(SAMPLE_SCRIPT)}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.color = "var(--accent-violet)";
              (e.target as HTMLButtonElement).style.borderColor = "var(--accent-violet)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.color = "var(--muted)";
              (e.target as HTMLButtonElement).style.borderColor = "var(--border)";
            }}
          >
            Load sample script
          </button>
          <button
            onClick={() => onChange("")}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors cursor-pointer"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.color = "var(--error)";
              (e.target as HTMLButtonElement).style.borderColor = "var(--error)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.color = "var(--muted)";
              (e.target as HTMLButtonElement).style.borderColor = "var(--border)";
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Paste or type your podcast script here..."
        rows={12}
        className="w-full rounded-lg p-4 text-sm resize-y outline-none transition-colors font-sans leading-relaxed"
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
          minHeight: "200px",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "var(--accent-teal)";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "var(--border)";
        }}
      />

      <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span>
          {wordCount} word{wordCount !== 1 ? "s" : ""}
        </span>
        <span>{charCount.toLocaleString()} characters</span>
      </div>
    </div>
  );
}
