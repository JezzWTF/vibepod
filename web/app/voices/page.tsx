"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Voice, VoiceUsage } from "@/lib/types/episode";
import VoiceDialog from "@/components/VoiceDialog";
import VoiceEditDialog from "@/components/VoiceEditDialog";
import "../studio.css";
import "./voices.css";

function usageLabel(usage?: VoiceUsage) {
  if (!usage) return "Not used yet";
  const episodes = usage.episodes.length;
  return `${episodes} episode${episodes === 1 ? "" : "s"} · ${usage.blocks} block${usage.blocks === 1 ? "" : "s"}`;
}

export default function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([]),
    [usage, setUsage] = useState<Record<string, VoiceUsage>>({}),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState<Voice | null>(null),
    [removing, setRemoving] = useState<Voice | null>(null),
    [deleting, setDeleting] = useState(false),
    [playing, setPlaying] = useState<string | null>(null),
    [toast, setToast] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      const [list, used] = await Promise.all([api("voices"), api("voices/usage")]);
      setVoices(list);
      setUsage(used);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    []
  );
  useEffect(() => {
    const dialog = confirmDialog.current;
    if (removing && !dialog?.open) dialog?.showModal();
    else if (!removing && dialog?.open) dialog.close();
  }, [removing]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  function play(id: string) {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const player = new Audio(`/api/voices/${encodeURIComponent(id)}/audio`);
    audio.current = player;
    player.onended = () => setPlaying(null);
    player
      .play()
      .then(() => setPlaying(id))
      .catch(() => setError("This voice could not be played. Try again."));
  }
  async function remove() {
    if (!removing) return;
    setDeleting(true);
    try {
      await api(`voices/${encodeURIComponent(removing.id)}`, "DELETE");
      if (playing === removing.id) {
        audio.current?.pause();
        setPlaying(null);
      }
      setToast(`${removing.name} deleted`);
      setRemoving(null);
      await load();
      searchInput.current?.focus();
    } catch (e) {
      setError((e as Error).message);
      setRemoving(null);
    } finally {
      setDeleting(false);
    }
  }
  const visible = voices.filter((v) =>
    `${v.name} ${v.description ?? ""} ${v.transcript ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const removingUsage = removing ? usage[removing.id] : undefined;
  return (
    <div className="studio-app studio-voices">
      <header className="studio-topbar">
        <div className="studio-breadcrumb">Voices</div>
        <button className="studio-primary voices-add" onClick={() => setAdding(true)}>
          Add voice
        </button>
      </header>
      <main className="voices-main">
        <p className="studio-eyebrow">Voices / Manage</p>
        <h1>Your cast of voices.</h1>
        <div className="library-tools">
          <input
            ref={searchInput}
            aria-label="Search voices"
            placeholder="Search voices…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button disabled={loading} onClick={() => load()}>
            Refresh
          </button>
        </div>
        {error && (
          <p className="studio-error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="voices-table-heading">
          <span>Voice</span>
          <span>Used in</span>
          <span />
        </div>
        {visible.map((v) => (
          <article key={v.id} className="voice-row">
            <button
              className="voice-play"
              aria-label={playing === v.id ? `Stop ${v.name}` : `Play ${v.name}`}
              onClick={() => play(v.id)}
            >
              {playing === v.id ? "■" : "▶"}
            </button>
            <div className="voice-info">
              <strong>{v.name}</strong>
              <span className="voice-kind">{v.kind === "design" ? "Designed" : "Cloned"}</span>
              <p>{v.description || v.transcript || "No description"}</p>
            </div>
            <div className="voice-usage">
              <span>{usageLabel(usage[v.id])}</span>
              {usage[v.id] && (
                <small>
                  {usage[v.id].episodes
                    .slice(0, 2)
                    .map((e) => e.title)
                    .join(", ")}
                  {usage[v.id].episodes.length > 2 && ` +${usage[v.id].episodes.length - 2}`}
                </small>
              )}
            </div>
            <div className="voice-actions">
              <button onClick={() => setEditing(v)}>Edit</button>
              <button className="voice-delete" onClick={() => setRemoving(v)}>
                Delete
              </button>
            </div>
          </article>
        ))}
        {!loading && !error && !visible.length && (
          <div className="voices-empty">
            <h2>{search ? "No matching voices" : "No voices yet"}</h2>
            {!search && (
              <>
                <p>Clone one from a recording or design one from a description.</p>
                <button className="studio-primary" onClick={() => setAdding(true)}>
                  Add voice
                </button>
              </>
            )}
          </div>
        )}
      </main>
      <VoiceDialog open={adding} onClose={() => setAdding(false)} onSaved={load} />
      <VoiceEditDialog
        voice={editing}
        onClose={() => setEditing(null)}
        onSaved={(voice) => {
          setEditing(null);
          setToast(`${voice.name} updated`);
          load();
        }}
      />
      <dialog
        ref={confirmDialog}
        className="library-dialog"
        aria-labelledby="voice-delete-title"
        onCancel={(e) => {
          e.preventDefault();
          if (!deleting) setRemoving(null);
        }}
      >
        {removing && (
          <>
            <h2 id="voice-delete-title">Delete {removing.name}?</h2>
            <p>
              {removingUsage
                ? `It is cast in ${usageLabel(removingUsage)}. Those blocks will be left without a voice, and their existing takes keep their audio.`
                : "No episode uses this voice."}
            </p>
            <footer>
              <button disabled={deleting} onClick={() => setRemoving(null)}>
                Keep voice
              </button>
              <button className="voice-delete" disabled={deleting} onClick={remove}>
                {deleting ? "Deleting…" : "Delete voice"}
              </button>
            </footer>
          </>
        )}
      </dialog>
      {toast && (
        <div className="library-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
