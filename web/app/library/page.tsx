"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationJob } from "@/lib/types/generation";
import type {
  EpisodeAction,
  EpisodeCounts,
  EpisodeState,
  EpisodeSummary,
} from "@/lib/types/episode";
import "../studio.css";

const PAGE_SIZE = 24;
const EPISODE_STATES: { id: EpisodeState; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "archived", label: "Archived" },
  { id: "trashed", label: "Trash" },
];
const EPISODE_NOTES: Record<EpisodeState, string> = {
  active: "",
  archived: "Archived episodes keep their audio and can be opened or returned to Active.",
  trashed: "Trash keeps your script, takes and exports. Nothing is automatically erased.",
};
const EPISODE_EMPTY: Record<EpisodeState, [string, string]> = {
  active: [
    "Your first conversation starts in Studio",
    "Create an episode and it will be saved here automatically.",
  ],
  archived: ["No archived episodes", "Archive finished episodes to keep Active focused."],
  trashed: ["Trash is empty", "Episodes you remove stay recoverable here."],
};
const TOAST: Record<EpisodeAction, string> = {
  archive: "Episode archived",
  trash: "Episode moved to Trash",
  restore: "Episode restored",
};
export default function LibraryPage() {
  const [tab, setTab] = useState("episodes"),
    [episodes, setEpisodes] = useState<EpisodeSummary[]>([]),
    [takes, setTakes] = useState<GenerationJob[]>([]),
    [episodeState, setEpisodeState] = useState<EpisodeState>("active"),
    [counts, setCounts] = useState<EpisodeCounts | null>(null),
    [menu, setMenu] = useState<string | null>(null),
    [trashing, setTrashing] = useState<EpisodeSummary | null>(null),
    [toast, setToast] = useState<{ message: string; undo: () => void } | null>(null),
    [managing, setManaging] = useState(false);
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
            ? `/api/episodes?state=${episodeState}`
            : `/api/takes?limit=${PAGE_SIZE}&offset=${append ? takes.length : 0}`,
          { cache: "no-store" }
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.detail || "Cannot load the library");
        if (tab === "episodes") {
          setEpisodes(data.items);
          setCounts(data.counts);
        } else {
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
    [tab, episodeState, takes.length]
  );
  useEffect(() => {
    load();
    audio.current?.pause();
    setAudition(null);
    setConfirm(null);
    setMenu(null);
  }, [tab, episodeState]);
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
  async function manage(ep: EpisodeSummary, action: EpisodeAction, inverse: EpisodeAction) {
    setManaging(true);
    setError("");
    setMenu(null);
    try {
      const response = await fetch(`/api/episodes/${encodeURIComponent(ep.id)}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revision: ep.revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "Cannot update this episode");
      const moved = { ...ep, revision: data.revision };
      setToast({
        message: TOAST[action],
        undo: () => {
          setToast(null);
          manage(moved, inverse, action);
        },
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setManaging(false);
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
        <div className="studio-breadcrumb">Library</div>
      </header>
      <div className="library-workspace">
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
          {tab === "episodes" && (
            <div className="library-tabs library-states" role="tablist" aria-label="Episode status">
              {EPISODE_STATES.map(({ id, label }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={episodeState === id}
                  disabled={loading}
                  onClick={() => {
                    setEpisodeState(id);
                    setToast(null);
                  }}
                >
                  {label}
                  {counts && <span className="library-count">{counts[id]}</span>}
                </button>
              ))}
            </div>
          )}
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
                  <div className="library-episode-actions">
                    {episodeState === "trashed" ? (
                      <button disabled={managing} onClick={() => manage(ep, "restore", "trash")}>
                        Restore
                      </button>
                    ) : (
                      <>
                        <a href={`/?episode=${encodeURIComponent(ep.id)}`}>Open →</a>
                        <button
                          className="library-menu-trigger"
                          aria-label={`Manage ${ep.title}`}
                          aria-expanded={menu === ep.id}
                          onClick={() => setMenu(menu === ep.id ? null : ep.id)}
                        >
                          ⋯
                        </button>
                        {menu === ep.id && (
                          <div className="library-menu" role="menu">
                            <button
                              role="menuitem"
                              disabled={managing}
                              onClick={() =>
                                episodeState === "active"
                                  ? manage(ep, "archive", "restore")
                                  : manage(ep, "restore", "archive")
                              }
                            >
                              {episodeState === "active" ? "Archive episode" : "Return to Active"}
                            </button>
                            <button
                              role="menuitem"
                              className="library-danger"
                              disabled={managing}
                              onClick={() => {
                                setMenu(null);
                                setTrashing(ep);
                              }}
                            >
                              Move to Trash
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
              {!loading && !error && !visibleEpisodes.length && (
                <div className="studio-empty">
                  <h2>{search ? "No matching episodes" : EPISODE_EMPTY[episodeState][0]}</h2>
                  <p>{search ? "Try another title." : EPISODE_EMPTY[episodeState][1]}</p>
                  {episodeState === "active" && !search && (
                    <a className="studio-primary" href="/">
                      Open Studio
                    </a>
                  )}
                </div>
              )}
              {EPISODE_NOTES[episodeState] && (
                <p className="studio-muted library-note">{EPISODE_NOTES[episodeState]}</p>
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
      {toast && (
        <div className="library-toast" role="status">
          <span>{toast.message}</span>
          <button disabled={managing} onClick={toast.undo}>
            Undo
          </button>
          <button aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
      {trashing && (
        <div className="library-dialog-backdrop" onClick={() => setTrashing(null)}>
          <div
            className="library-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="trash-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setTrashing(null)}
          >
            <h2 id="trash-title">Move episode to Trash?</h2>
            <strong>{trashing.title}</strong>
            <p>
              The script, takes and exports stay together. You can restore the episode from Trash.
            </p>
            <footer>
              <button autoFocus onClick={() => setTrashing(null)}>
                Keep episode
              </button>
              <button
                className="library-danger"
                onClick={() => {
                  const ep = trashing;
                  setTrashing(null);
                  manage(ep, "trash", "restore");
                }}
              >
                Move to Trash
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
