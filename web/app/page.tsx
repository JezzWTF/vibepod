"use client";
import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/hooks/useStudio";
import TakeInspector from "@/components/TakeInspector";
import StudioTransport from "@/components/StudioTransport";
import VoiceDialog from "@/components/VoiceDialog";
import ExportDialog from "@/components/ExportDialog";
import "./studio.css";

export default function StudioPage() {
  const studio = useStudio();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [stopSignal, setStopSignal] = useState(0);
  const [selected, setSelected] = useState(0),
    [importing, setImporting] = useState(false),
    [script, setScript] = useState("");
  const [audition, setAudition] = useState<string | null>(null),
    [mediaError, setMediaError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const ep = studio.episode;
  const block = ep?.blocks[selected];
  const cast = Array.from(new Set(ep?.blocks.map((b) => b.speaker) ?? []));
  const active =
    ep?.blocks.flatMap((b) => b.takes).filter((t) => ["queued", "generating"].includes(t.status)) ??
    [];
  const missing = ep?.blocks.filter((b) => !b.selected_take_id || b.stale).length ?? 0;
  const playable =
    ep?.blocks.flatMap((block) => {
      const take = block.takes.find(
        (take) => take.id === block.selected_take_id && take.status === "complete"
      );
      return take ? [{ block, take }] : [];
    }) ?? [];
  let previewCursor = 0;
  const startOffsets: Record<string, number> = {};
  for (const { block, take } of playable) {
    if (block.id) startOffsets[block.id] = previewCursor;
    previewCursor += (take.duration_secs ?? 0) + (ep?.gap_secs ?? 0);
  }
  useEffect(() => {
    audio.current?.pause();
    setSelected(0);
    setAudition(null);
  }, [ep?.id]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    []
  );
  function play(id: string) {
    setStopSignal((value) => value + 1);
    audio.current?.pause();
    if (audition === id) {
      setAudition(null);
      return;
    }
    const player = new Audio(`/api/takes/${id}/audio`);
    audio.current = player;
    player.onended = () => setAudition(null);
    setMediaError("");
    player
      .play()
      .then(() => setAudition(id))
      .catch(() => setMediaError("This take could not be played. Try again."));
  }
  return (
    <div className="studio-app">
      <a href="#script" className="studio-skip">
        Skip to script
      </a>
      <header className="studio-topbar">
        <div className="studio-brand">
          <span className="studio-mark">▥</span>
          <strong>VibePod</strong>
          <span>Studio</span>
        </div>
        <div className="studio-breadcrumb">
          Episodes <span>/</span> {ep?.title ?? "Workspace"}
        </div>
        <span className="studio-save" role="status">
          {studio.status}
        </span>
        <button
          className="studio-primary"
          disabled={!ep || studio.busy}
          onClick={() => setExportOpen(true)}
        >
          Export
        </button>
        <button className="studio-secondary" disabled={studio.busy} onClick={() => studio.create()}>
          New episode
        </button>
      </header>
      <div className="studio-workspace">
        <nav className="studio-navigation" aria-label="Episode workspace">
          <p className="studio-eyebrow">Workspace</p>
          <span className="workspace-tab">
            Episodes <span>{studio.recent.length.toString().padStart(2, "0")}</span>
          </span>
          <a
            className="studio-archive"
            href="/library"
            onClick={async (e) => {
              e.preventDefault();
              try {
                await studio.save();
                window.location.assign("/library");
              } catch {}
            }}
          >
            Saved audio library →
          </a>
          <button
            className="studio-archive"
            onClick={() => {
              audio.current?.pause();
              setAudition(null);
              setStopSignal((v) => v + 1);
              setVoiceOpen(true);
            }}
          >
            + Add a voice
          </button>
          <div className="studio-nav-heading">
            <span>Recent episodes</span>
            <button
              aria-label="Create episode"
              disabled={studio.busy}
              onClick={() => studio.create()}
            >
              +
            </button>
          </div>
          <div className="episode-list">
            {studio.recent.map((e) => (
              <button
                key={e.id}
                onClick={() => studio.open(e.id)}
                disabled={studio.busy}
                className={e.id === ep?.id ? "is-current" : ""}
              >
                <strong>{e.title}</strong>
                <span>
                  {e.block_count} blocks ·{" "}
                  {new Date(e.updated_at).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </button>
            ))}
            {!studio.recent.length && (
              <p className="studio-muted">Your episodes will appear here.</p>
            )}
          </div>
          {ep && (
            <>
              <p className="studio-eyebrow cast-heading">Episode cast</p>
              {cast.map((speaker, i) => (
                <label className="cast-row" key={speaker}>
                  <span className={`cast-avatar cast-${i % 2}`}>
                    {speaker.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{speaker}</strong>
                    <select
                      disabled={studio.busy}
                      aria-label={`${speaker} voice`}
                      value={ep.blocks.find((b) => b.speaker === speaker)?.voice_id ?? ""}
                      onChange={(e) => studio.voice(speaker, e.target.value)}
                    >
                      <option value="">Assign voice</option>
                      {studio.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              ))}
            </>
          )}
          <div className="studio-local">
            Local workspace <span />
          </div>
        </nav>
        <main id="script" className="studio-script">
          {ep ? (
            <>
              <div className="episode-heading">
                <p className="studio-eyebrow">Episode / Script</p>
                <input
                  disabled={studio.busy}
                  aria-label="Episode title"
                  value={ep.title}
                  onChange={(e) => studio.edit({ title: e.target.value })}
                />
                <p>Write the conversation. Keep the best take of each line.</p>
              </div>
              <div className="script-toolbar">
                <button
                  disabled={studio.busy || studio.status === "Saving…" || ep.blocks.length >= 100}
                  onClick={studio.add}
                >
                  + Add block
                </button>
                <button onClick={() => setImporting(!importing)}>Import script</button>
                <span>{ep.blocks.length} blocks</span>
                <label className="gap-control">
                  Gap{" "}
                  <input
                    aria-label="Gap between lines"
                    disabled={studio.busy}
                    type="number"
                    min={0}
                    max={5}
                    step={0.05}
                    value={ep.gap_secs}
                    onChange={(e) => studio.edit({ gap_secs: Number(e.target.value) })}
                  />{" "}
                  s
                </label>
                {active.length ? (
                  <button
                    className="studio-secondary"
                    disabled={studio.busy}
                    onClick={studio.cancel}
                  >
                    Cancel · {active.length}
                  </button>
                ) : (
                  <button
                    className="studio-primary"
                    disabled={studio.busy || !ep.blocks.length}
                    onClick={() => studio.generate(undefined, "stale")}
                  >
                    Generate missing{missing ? ` · ${missing}` : ""}
                  </button>
                )}
                <button
                  className="generate-all"
                  disabled={studio.busy || !ep.blocks.length || !!active.length}
                  onClick={() => studio.generate(undefined, "all")}
                >
                  Generate all
                </button>
              </div>
              {importing && (
                <section className="script-import">
                  <label>
                    Paste one speaker line per paragraph
                    <textarea
                      aria-label="Script to import"
                      placeholder="Alice: Welcome back.&#10;Frank: It’s good to be here."
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      rows={5}
                    />
                  </label>
                  <button
                    className="studio-primary"
                    disabled={studio.busy}
                    onClick={() => {
                      if (studio.importScript(script)) {
                        setScript("");
                        setImporting(false);
                      }
                    }}
                  >
                    Add to episode
                  </button>
                </section>
              )}
              <div className="script-column-headings">
                <span>Script</span>
                <span>Takes</span>
              </div>
              {ep.blocks.map((b, i) => {
                const chosen = b.takes.find((t) => t.id === b.selected_take_id);
                const stale =
                  !!chosen && (chosen.script !== b.text || chosen.voice_id !== b.voice_id);
                return (
                  <article
                    key={b.id ?? `new-${i}`}
                    className={`script-row ${i === selected ? "is-focused" : ""}`}
                    onClick={() => setSelected(i)}
                  >
                    <span className="block-number">{(i + 1).toString().padStart(2, "0")}</span>
                    <div className="script-row-body">
                      <div className="block-heading">
                        <input
                          aria-label={`Speaker for block ${i + 1}`}
                          disabled={studio.busy}
                          value={b.speaker}
                          onChange={(e) =>
                            studio.block(i, {
                              speaker: e.target.value,
                              voice_id:
                                ep.blocks.find((x) => x.speaker === e.target.value)?.voice_id ??
                                null,
                            })
                          }
                        />
                        <span>{b.takes.length.toString().padStart(2, "0")}</span>
                      </div>
                      <textarea
                        aria-label={`Script block ${i + 1}`}
                        disabled={studio.busy}
                        value={b.text}
                        placeholder="Write this line…"
                        rows={Math.max(2, Math.ceil(b.text.length / 75))}
                        onFocus={() => setSelected(i)}
                        onChange={(e) => studio.block(i, { text: e.target.value })}
                      />
                      <div className="block-controls">
                        <button disabled={!chosen} onClick={() => chosen && play(chosen.id)}>
                          {audition === chosen?.id ? "Ⅱ Pause" : "▷ Play line"}
                        </button>
                        <time>{chosen?.duration_secs?.toFixed(1) ?? "—"} s</time>
                        <button
                          disabled={
                            studio.busy ||
                            !b.id ||
                            !b.voice_id ||
                            !b.text.trim() ||
                            b.takes.some((t) => ["queued", "generating"].includes(t.status))
                          }
                          onClick={() => b.id && studio.generate(b.id)}
                        >
                          {b.takes.length ? "↻ Regenerate" : "Generate"}
                        </button>
                        <span className={stale ? "block-stale" : "block-selected"}>
                          {stale
                            ? "Text or voice changed"
                            : chosen
                              ? `Selected · ${b.takes.findIndex((t) => t.id === chosen.id) + 1}`
                              : (b.takes.find((t) => ["queued", "generating"].includes(t.status))
                                  ?.status ?? "No selected take")}
                        </span>
                        <button
                          className="remove-block"
                          aria-label={`Remove block ${i + 1}`}
                          disabled={
                            studio.busy ||
                            studio.status === "Saving…" ||
                            b.takes.some((t) => ["queued", "generating"].includes(t.status))
                          }
                          onClick={() => {
                            studio.edit({ blocks: ep.blocks.filter((_, j) => j !== i) });
                            setSelected(Math.max(0, i - 1));
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {!ep.blocks.length && (
                <div className="studio-empty">
                  <h2>Start with the conversation</h2>
                  <p>
                    Import a script written as Speaker: line, or add a block and write the first
                    line. Assign each speaker a saved voice in the cast.
                  </p>
                  <button className="studio-primary" onClick={studio.add}>
                    Add the first block
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="studio-empty">
              <p className="studio-eyebrow">VibePod Studio</p>
              <h1>Make room for the conversation.</h1>
              <p>
                Create an episode, write the script, and choose the take of each line you want your
                listeners to hear.
              </p>
              <button className="studio-primary" disabled={studio.busy} onClick={studio.create}>
                Create an episode
              </button>
            </div>
          )}
          {(studio.error || mediaError) && (
            <div className="studio-error-banner" role="alert">
              {studio.error || mediaError}
              {studio.status === "Save failed" && (
                <button onClick={() => studio.save().catch(() => {})}>Retry save</button>
              )}
            </div>
          )}
        </main>
        <TakeInspector
          block={block}
          index={selected}
          busy={studio.busy}
          audition={audition}
          onAudition={play}
          onSelect={(tid) => block?.id && studio.select(block.id, tid)}
          onGenerate={() => block?.id && studio.generate(block.id)}
        />
      </div>
      <StudioTransport
        key={ep?.id ?? "empty"}
        title={ep?.title ?? "No episode open"}
        playlist={{
          src:
            playable.length && ep
              ? `/api/episodes/${ep.id}/audio?preview=true&selection=${encodeURIComponent(playable.map(({ take }) => take.id).join(","))}&gap=${ep.gap_secs}`
              : null,
          readyCount: playable.length,
          totalCount: ep?.blocks.length ?? 0,
          duration: Math.max(0, previewCursor - (playable.length ? (ep?.gap_secs ?? 0) : 0)),
          startOffsets,
        }}
        selectedBlockId={block?.id ?? null}
        stopSignal={stopSignal}
        onPlay={() => {
          audio.current?.pause();
          setAudition(null);
        }}
      />
      <VoiceDialog
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onSaved={studio.refreshVoices}
      />
      <ExportDialog
        episode={ep}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onSave={studio.save}
      />
    </div>
  );
}
