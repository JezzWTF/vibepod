"use client";
import { useEffect, useRef, useState } from "react";
import type { GenerationJob } from "@/lib/types/generation";

export default function VoiceDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previewAudio = useRef<HTMLAudioElement>(null);
  const [tab, setTab] = useState("clone"),
    [name, setName] = useState(""),
    [transcript, setTranscript] = useState(""),
    [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<GenerationJob | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else {
      dialog.current?.close();
      previewAudio.current?.pause();
    }
  }, [open]);
  useEffect(() => () => previewAudio.current?.pause(), []);
  useEffect(() => {
    if (!preview || !["queued", "generating"].includes(preview.status)) return;
    const timer = setInterval(
      () =>
        fetch(`/api/takes/${preview.id}`, { cache: "no-store" })
          .then(async (r) => {
            if (!r.ok) throw new Error("Cannot reach the voice preview.");
            return r.json();
          })
          .then(setPreview)
          .catch(() => setError("Cannot reach the voice preview.")),
      2000
    );
    return () => clearInterval(timer);
  }, [preview?.id, preview?.status]);
  async function request(path: string, body: FormData | object) {
    const response = await fetch(`/api/${path}`, {
      method: "POST",
      headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.detail === "string" ? data.detail : "Check the voice details and try again."
      );
    return data;
  }
  async function perform(save: boolean) {
    setBusy(true);
    setError("");
    try {
      if (tab === "clone") {
        if (!file) throw new Error("Choose a WAV reference.");
        const form = new FormData();
        form.append("name", name.trim());
        form.append("transcript", transcript);
        form.append("file", file);
        await request("voices", form);
      } else if (!save) {
        setPreview(await request("voices/design", { name: name.trim(), description }));
        return;
      } else {
        if (!preview) return;
        await request("voices/design/save", { name: name.trim(), take_id: preview.id });
      }
      await onSaved();
      onClose();
      setName("");
      setPreview(null);
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const generating = !!preview && ["queued", "generating"].includes(preview.status);
  return (
    <dialog
      ref={dialog}
      className="studio-dialog"
      aria-labelledby="voice-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <div>
          <h2 id="voice-title">Add a voice</h2>
          <p>Save a reusable voice for your episode cast.</p>
        </div>
        <button aria-label="Close voice panel" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dialog-body">
        <div className="dialog-tabs" role="tablist" aria-label="Voice source">
          {["clone", "design"].map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              disabled={busy || generating}
              onClick={() => {
                setTab(t);
                setError("");
              }}
            >
              {t === "clone" ? "Clone" : "Design"}
            </button>
          ))}
        </div>
        <label>
          Voice name
          <input
            value={name}
            maxLength={80}
            disabled={busy || generating}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {tab === "clone" ? (
          <>
            <label>
              Reference audio
              <input
                type="file"
                accept=".wav,audio/wav"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <small>3–30 seconds of clear speech · up to 10 MB</small>
            </label>
            <label>
              Reference transcript <span>· optional</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={transcript}
                disabled={busy}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="The words spoken in the reference recording…"
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Describe the voice
              <textarea
                rows={5}
                minLength={10}
                maxLength={1000}
                value={description}
                disabled={busy || generating}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setPreview(null);
                }}
                placeholder="A warm, clear British voice with a measured pace and a natural conversational tone."
              />
            </label>
            <p className="studio-muted">
              Create a preview, listen, then save the voice you want to use.
            </p>
            {preview && (
              <section className="voice-preview" aria-live="polite">
                <p>
                  {generating
                    ? `${preview.status === "queued" ? "Queued" : "Creating voice preview"}…`
                    : preview.status === "complete"
                      ? "Preview ready"
                      : preview.error_message || "Preview cancelled"}
                </p>
                {preview.status === "complete" && (
                  <audio ref={previewAudio} controls src={`/api/takes/${preview.id}/audio`} />
                )}{" "}
                {generating && (
                  <button
                    onClick={() =>
                      request(`takes/${preview.id}/cancel`, {})
                        .then(setPreview)
                        .catch((e) => setError(e.message))
                    }
                  >
                    Cancel preview
                  </button>
                )}
              </section>
            )}
          </>
        )}
        {error && (
          <p className="studio-dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <div>
          {tab === "design" && (
            <button
              className="studio-secondary"
              disabled={busy || generating || !name.trim() || description.trim().length < 10}
              onClick={() => perform(false)}
            >
              {preview ? "New preview" : "Create preview"}
            </button>
          )}
          <button
            className="studio-primary"
            disabled={
              busy || !name.trim() || (tab === "clone" ? !file : preview?.status !== "complete")
            }
            onClick={() => perform(true)}
          >
            {busy ? "Saving…" : "Save voice"}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
