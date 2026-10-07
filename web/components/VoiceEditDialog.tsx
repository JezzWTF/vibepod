"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Voice } from "@/lib/types/episode";

export default function VoiceEditDialog({
  voice,
  onClose,
  onSaved,
}: {
  voice: Voice | null;
  onClose: () => void;
  onSaved: (voice: Voice) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(""),
    [transcript, setTranscript] = useState(""),
    [description, setDescription] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (voice) {
      setName(voice.name);
      setTranscript(voice.transcript ?? "");
      setDescription(voice.description ?? "");
      setError("");
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [voice]);
  async function save() {
    if (!voice) return;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api(`voices/${encodeURIComponent(voice.id)}`, "PATCH", {
          name: name.trim(),
          transcript,
          description,
        })
      );
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
      aria-labelledby="voice-edit-title"
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <div>
          <h2 id="voice-edit-title">Edit voice</h2>
          <p>{voice?.kind === "design" ? "Designed voice" : "Cloned voice"}</p>
        </div>
        <button aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dialog-body">
        <label>
          Voice name
          <input
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {voice?.kind === "design" && (
          <label>
            Description
            <textarea
              rows={4}
              maxLength={4000}
              value={description}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        )}
        <label>
          Reference transcript <span>· optional</span>
          <textarea
            rows={4}
            maxLength={4000}
            value={transcript}
            disabled={busy}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </label>
        {error && (
          <p className="studio-dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <button onClick={onClose}>Cancel</button>
        <button className="studio-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </footer>
    </dialog>
  );
}
