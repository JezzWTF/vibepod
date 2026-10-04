"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationJob } from "@/lib/types/generation";
import type { EpisodeSummary } from "@/lib/types/episode";
import "../studio.css";

const PAGE_SIZE = 24;
export default function LibraryPage() {
  const [tab, setTab] = useState("episodes"),
    [episodes, setEpisodes] = useState<EpisodeSummary[]>([]),
    [takes, setTakes] = useState<GenerationJob[]>([]);
  const [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [hasMore, setHasMore] = useState(false),
    [audition, setAudition] = useState<string | null>(null),
    [confirm, setConfirm] = useState<string | null>(null),
    [deleting, setDeleting] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null),
    requesting = useRef(false);
  const load = useCallback(
    async (append = false) => {
      if (requesting.current) return;
      requesting.current = true;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          tab === "episodes"
            ? "/api/episodes"
            : `/api/takes?limit=${PAGE_SIZE}&offset=${append ? takes.length : 0}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || "Cannot load the library");
        if (tab === "episodes") setEpisodes(data.items);
        else {
          setTakes((previous) => (append ? [...previous, ...data.items] : data.items));
          setHasMore(data.items.length === PAGE_SIZE);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        requesting.current = false;
        setLoading(false);
      }
    },
    [tab, takes.length]
  );
  useEffect(() => {
    load();
    audio.current?.pause();
    setAudition(null);
    setConfirm(null);
  }, [tab]);
  useEffect(() => () => audio.current?.pause(), []);
  function play(id: string) {
    audio.current?.pause();
    if (audition === id) {
      setAudition(null);
      return;
    }
    const player = new Audio(`/api/takes/${id}/audio`);
    audio.current = player;
    player.onended = () => setAudition(null);
    player
      .play()
      .then(() => setAudition(id))
      .catch(() => setError("Audio could not be played. Try again."));
  }
  async function remove(id: string) {
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/takes/${id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "Cannot delete this take");
      setTakes((previous) => previous.filter((t) => t.id !== id));
      setConfirm(null);
      if (audition === id) {
        audio.current?.pause();
        setAudition(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  const visibleEpisodes = episodes.filter((e) =>
    e.title.toLowerCase().includes(search.toLowerCase())
  );
  const visibleTakes = takes.filter((t) =>
    `${t.script} ${t.speaker}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="studio-app studio-library">
      <header className="studio-topbar">
        <div className="studio-brand">
          <span className="studio-mark">▥</span>
          <strong>VibePod</strong>
          <span>Studio</span>
        </div>
        <div className="studio-breadcrumb">Library</div>
        <a className="studio-secondary library-back" href="/">
          Back to Studio
        </a>
      </header>
      <div className="library-workspace">
        <nav className="studio-navigation" aria-label="Workspace">
          <p className="studio-eyebrow">Workspace</p>
          <a className="studio-archive" href="/">
            Studio
          </a>
          <span className="workspace-tab">Library</span>
          <div className="studio-local">
            Local workspace <span />
          </div>
        </nav>
        <main className="library-main">
          <p className="studio-eyebrow">Library / Episodes and takes</p>
          <h1>Your conversations, kept.</h1>
          <p className="studio-muted">
            Reopen an episode or find a saved take. Every version stays linked to its script.
          </p>
          <div className="library-tabs" role="tablist" aria-label="Library view">
            {["episodes", "takes"].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                disabled={loading}
                onClick={() => {
                  setTab(t);
                  setSearch("");
                }}
              >
                {t === "episodes" ? "Episodes" : "All takes"}
              </button>
            ))}
          </div>
          <div className="library-tools">
            <input
              aria-label={tab === "episodes" ? "Search episodes" : "Search loaded takes"}
              placeholder={tab === "episodes" ? "Search episodes…" : "Search loaded takes…"}
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
          {tab === "episodes" ? (
            <div className="library-episodes">
              <div className="library-table-heading">
                <span>Episode</span>
                <span>Blocks</span>
                <span>Updated</span>
                <span />
              </div>
              {visibleEpisodes.map((ep) => (
                <article key={ep.id}>
                  <div>
                    <strong>{ep.title}</strong>
                    <p>Open the script, cast, takes and exports</p>
                  </div>
                  <span>{ep.block_count}</span>
                  <time>{new Date(ep.updated_at).toLocaleDateString()}</time>
                  <a href={`/?episode=${encodeURIComponent(ep.id)}`}>Open →</a>
                </article>
              ))}
              {!loading && !error && !visibleEpisodes.length && (
                <div className="studio-empty">
                  <h2>
                    {search ? "No matching episodes" : "Your first conversation starts in Studio"}
                  </h2>
                  <p>
                    {search
                      ? "Try another title."
                      : "Create an episode and it will be saved here automatically."}
                  </p>
                  <a className="studio-primary" href="/">
                    Open Studio
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="library-takes">
              {visibleTakes.map((t) => (
                <article key={t.id}>
                  <div>
                    <p className="studio-eyebrow">
                      {t.speaker} · {t.status}
                      {t.episode_id ? " · episode take" : ""}
                    </p>
                    <p className="library-take-script">{t.script}</p>
                    <span className="studio-muted">
                      {t.duration_secs?.toFixed(1) ?? "—"} s ·{" "}
                      {new Date(t.created_at).toLocaleString()}
                    </span>
                    {t.error_message && <p className="studio-dialog-error">{t.error_message}</p>}
                  </div>
                  <div className="library-take-actions">
                    <button disabled={t.status !== "complete"} onClick={() => play(t.id)}>
                      {audition === t.id ? "Pause" : "Audition"}
                    </button>
                    {t.status === "complete" && (
                      <a href={`/api/takes/${t.id}/audio`} download={`${t.id}.wav`}>
                        Download WAV
                      </a>
                    )}
                    {t.episode_id && (
                      <a href={`/?episode=${encodeURIComponent(t.episode_id)}`}>Open episode</a>
                    )}
                    <button
                      disabled={deleting || ["queued", "generating"].includes(t.status)}
                      onClick={() => setConfirm(t.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {confirm === t.id && (
                    <div className="library-delete-confirm" role="alert">
                      <span>Delete this take and its audio permanently?</span>
                      <button disabled={deleting} onClick={() => setConfirm(null)}>
                        Keep take
                      </button>
                      <button disabled={deleting} onClick={() => remove(t.id)}>
                        Delete take
                      </button>
                    </div>
                  )}
                </article>
              ))}
              {!loading && !error && !visibleTakes.length && (
                <p className="studio-muted">
                  {search
                    ? "No matching takes in the loaded results."
                    : "Your generated takes will appear here."}
                </p>
              )}
              {hasMore && (
                <button className="studio-secondary" disabled={loading} onClick={() => load(true)}>
                  Load more takes
                </button>
              )}
            </div>
          )}
          {loading && (
            <p className="studio-muted" role="status">
              Loading library…
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
