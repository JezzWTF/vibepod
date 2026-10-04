"use client";
import { useEffect, useState } from "react";
import type { ScriptBlock } from "@/lib/types/episode";
import type { WaveformPeaks } from "@/lib/types/generation";
import WaveformPreview from "./WaveformPreview";

function TakeWaveform({ id }: { id: string }) {
  const [peaks, setPeaks] = useState<WaveformPeaks | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/takes/${id}/waveform`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setPeaks(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  return peaks ? (
    <WaveformPreview peaks={peaks} height={32} color="#aed5bf" />
  ) : (
    <div className="waveform-loading" aria-label="Loading waveform" />
  );
}
export default function TakeInspector({
  block,
  index,
  onSelect,
  onAudition,
  onGenerate,
  busy,
  audition,
}: {
  block: ScriptBlock | undefined;
  index: number;
  onSelect: (id: string) => void;
  onAudition: (id: string) => void;
  onGenerate: () => void;
  busy: boolean;
  audition: string | null;
}) {
  return (
    <aside className="studio-inspector">
      <p className="studio-eyebrow">Take inspector</p>
      {block ? (
        <>
          <h2>Block {(index + 1).toString().padStart(2, "0")}</h2>
          <p className="studio-muted">
            {block.speaker} · {block.takes.length} takes
          </p>
          <div className="inspector-takes">
            {[...block.takes].reverse().map((take, i) => (
              <section
                key={take.id}
                className={`inspector-take ${take.id === block.selected_take_id ? "is-selected" : ""}`}
              >
                <div className="take-heading">
                  <strong>Take {block.takes.length - i}</strong>
                  <span>
                    {take.id === block.selected_take_id
                      ? "Selected"
                      : take.status !== "complete"
                        ? take.status
                        : ""}
                  </span>
                </div>
                <p className="take-previous-text">
                  Voice: {take.speaker}
                  {take.voice_id !== block.voice_id ? " · previous assignment" : ""}
                </p>
                {take.status === "complete" && <TakeWaveform id={take.id} />}
                {take.error_message && <p className="studio-error">{take.error_message}</p>}
                <div className="take-actions">
                  <button disabled={take.status !== "complete"} onClick={() => onAudition(take.id)}>
                    {audition === take.id ? "Ⅱ Pause" : "▷ Audition"}
                  </button>
                  <time>{take.duration_secs?.toFixed(1) ?? "—"} s</time>
                  {take.status === "complete" && take.id !== block.selected_take_id && (
                    <button disabled={busy} onClick={() => onSelect(take.id)}>
                      Use take
                    </button>
                  )}
                </div>
                {take.script !== block.text && (
                  <p className="take-previous-text">Generated text: {take.script}</p>
                )}
              </section>
            ))}
            {!block.takes.length && (
              <div className="inspector-empty">
                <strong>No takes for this line</strong>
                <p>Assign a voice and generate the line. Each regeneration adds another take.</p>
              </div>
            )}
          </div>
          <div className="inspector-details">
            <h3>Line details</h3>
            <dl>
              <dt>Speaker</dt>
              <dd>{block.speaker}</dd>
              <dt>Selection</dt>
              <dd>
                {block.stale
                  ? "Text or voice changed"
                  : block.selected_take_id
                    ? "Up to date"
                    : "No selected take"}
              </dd>
            </dl>
            <button
              className="studio-secondary"
              disabled={
                busy ||
                !block.voice_id ||
                !block.text.trim() ||
                block.takes.some((t) => ["queued", "generating"].includes(t.status))
              }
              onClick={onGenerate}
            >
              {block.takes.length ? "Regenerate this line" : "Generate this line"}
            </button>
          </div>
        </>
      ) : (
        <div className="inspector-empty">
          <h2>Your takes live here</h2>
          <p>Select a script block to compare its takes and choose the one to use.</p>
        </div>
      )}
    </aside>
  );
}
