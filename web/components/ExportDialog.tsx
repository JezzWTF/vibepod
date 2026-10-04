"use client";
import { useEffect, useRef, useState } from "react";
import type { Episode } from "@/lib/types/episode";

type ExportJob = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  error: string | null;
  measured_lufs: number | null;
  created_at: string;
  options: { format: string; title: string; show: string; number: number | null };
};
export default function ExportDialog({
  episode,
  open,
  onClose,
  onSave,
}: {
  episode: Episode | null;
  open: boolean;
  onClose: () => void;
  onSave: () => Promise<Episode | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sourceTitle = useRef("");
  const [format, setFormat] = useState("mp3"),
    [title, setTitle] = useState(""),
    [show, setShow] = useState(""),
    [number, setNumber] = useState("");
  const [artwork, setArtwork] = useState<File | null>(null),
    [jobs, setJobs] = useState<ExportJob[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const id = episode?.id;
  useEffect(() => {
    const previous = sourceTitle.current;
    const next = episode?.title ?? "";
    setTitle((value) => (value === previous || !value ? next : value));
    sourceTitle.current = next;
  }, [episode?.title]);
  useEffect(() => {
    setTitle(episode?.title ?? "");
    setShow("");
    setNumber("");
    setArtwork(null);
    setJobs([]);
    setError("");
  }, [id]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (!open || !id) return;
    let alive = true;
    const load = () =>
      fetch(`/api/episodes/${id}/exports`, { cache: "no-store" })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.detail || data.error || "Cannot load exports");
          if (alive) {
            setJobs(data.items);
            setError((previous) =>
              previous === "Cannot reach the GPU server" || previous === "Cannot load exports"
                ? ""
                : previous
            );
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    const timer = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, id]);
  const active = jobs.some((j) => ["queued", "running"].includes(j.status));
  const ready =
    !!episode?.blocks.length &&
    episode.blocks.every((b) =>
      b.takes.some((t) => t.id === b.selected_take_id && t.status === "complete")
    );
  async function create() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      await onSave();
      const form = new FormData();
      form.append("format", format);
      form.append("title", title.trim());
      form.append("show", show.trim());
      if (number) form.append("number", number);
      if (artwork && format === "mp3") form.append("artwork", artwork);
      const response = await fetch(`/api/episodes/${id}/exports`, { method: "POST", body: form });
      const job = await response.json();
      if (!response.ok)
        throw new Error(
          typeof job.detail === "string" ? job.detail : "Check the export details and try again."
        );
      setJobs((previous) => [job, ...previous]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      aria-labelledby="export-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <div>
          <h2 id="export-title">Export episode</h2>
          <p>Export the selected takes, with your chosen gaps.</p>
        </div>
        <button aria-label="Close export panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dialog-body">
        <label>Format</label>
        <div className="dialog-tabs" role="tablist" aria-label="Export format">
          {["mp3", "wav"].map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={format === f}
              disabled={busy || active}
              onClick={() => setFormat(f)}
            >
              {f.toUpperCase()} <span>· {f === "mp3" ? "podcast ready" : "lossless master"}</span>
            </button>
          ))}
        </div>
        <label>
          Episode title
          <input
            value={title}
            maxLength={160}
            disabled={busy || active}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="export-metadata">
          <label>
            Show name
            <input
              value={show}
              maxLength={160}
              disabled={busy || active}
              onChange={(e) => setShow(e.target.value)}
            />
          </label>
          <label>
            Episode number
            <input
              type="number"
              min={1}
              max={99999}
              step={1}
              value={number}
              disabled={busy || active}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
        </div>
        {format === "mp3" && (
          <label>
            Cover artwork <span>· optional</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              disabled={busy || active}
              onChange={(e) => setArtwork(e.target.files?.[0] ?? null)}
            />
            <small>Square JPG or PNG · 64–4000 pixels · up to 5 MB</small>
          </label>
        )}
        <section className="export-normalization">
          <strong>Loudness matched for podcast listening</strong>
          <p>Mono · −19 LUFS · true peak limited · selected takes only</p>
          {episode?.blocks.some((b) => b.stale) && (
            <p className="block-stale">
              Some selections use earlier text or voices. Export will use those selected takes.
            </p>
          )}
        </section>
        {!ready && (
          <p className="studio-muted">
            Select a completed take for every block before creating an export.
          </p>
        )}
        {jobs.length > 0 && (
          <section className="export-history" aria-label="Episode exports">
            <h3>Episode exports</h3>
            {jobs.map((job) => (
              <div key={job.id}>
                <div>
                  <strong>
                    {job.options.format.toUpperCase()} · {job.options.title}
                  </strong>
                  <span>
                    {job.status === "complete"
                      ? `${job.measured_lufs?.toFixed(1)} LUFS · ${new Date(job.created_at).toLocaleString()}`
                      : job.stage}
                  </span>
                </div>
                {job.status === "complete" ? (
                  <a href={`/api/episodes/${id}/exports/${job.id}/download`} download>
                    Download
                  </a>
                ) : job.status === "error" ? (
                  <p role="alert" className="studio-dialog-error">
                    {job.error}
                  </p>
                ) : (
                  <progress aria-label={`${job.stage} progress`} value={job.progress} max={1} />
                )}
              </div>
            ))}
          </section>
        )}
        {error && (
          <p className="studio-dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button onClick={onClose}>{active ? "Return to Studio" : "Cancel"}</button>
        <button
          className="studio-primary"
          disabled={
            busy ||
            active ||
            !ready ||
            !title.trim() ||
            (!!number &&
              (!Number.isInteger(Number(number)) || Number(number) < 1 || Number(number) > 99999))
          }
          onClick={create}
        >
          {busy ? "Starting…" : active ? "Exporting…" : "Create export"}
        </button>
      </footer>
    </dialog>
  );
}
