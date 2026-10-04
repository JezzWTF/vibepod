"use client";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import AudioPlayer from "@/components/AudioPlayer";
import type { GenerationJob } from "@/lib/types/generation";
type Voice = { id: string; name: string };
async function json(r: Response) {
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail ?? d.error ?? "Request failed");
  return d;
}
export default function Page() {
  const [voices, setVoices] = useState<Voice[]>([]),
    [voice, setVoice] = useState(""),
    [text, setText] = useState("");
  const [take, setTake] = useState<GenerationJob | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = take?.status === "queued" || take?.status === "generating";
  useEffect(() => {
    fetch("/api/voices")
      .then(json)
      .then(setVoices)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!active || !take) return;
    const timer = setInterval(
      () =>
        fetch(`/api/takes/${take.id}`)
          .then(json)
          .then(setTake)
          .catch((e) => setError(e.message)),
      1500
    );
    return () => clearInterval(timer);
  }, [active, take]);
  async function clone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const created = await json(
        await fetch("/api/voices", { method: "POST", body: new FormData(form) })
      );
      setVoices((v) => [...v, created]);
      setVoice(created.id);
      form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setTake(
        await json(
          await fetch("/api/takes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice_id: voice }),
          })
        )
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header />
      <main className="max-w-3xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Create a line take</h1>
          <p className="mt-2 text-sm">
            Choose a voice, write a line, and keep its audio in your library.
          </p>
        </div>
        <form
          onSubmit={clone}
          className="rounded-xl border p-5 space-y-3"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="font-semibold">Add a cloned voice</h2>
          <p className="text-sm">Upload 3–30 seconds of clean speech as a WAV.</p>
          <label className="block">
            Voice name
            <input
              name="name"
              required
              maxLength={80}
              className="block w-full border rounded p-2 mt-1"
            />
          </label>
          <label className="block">
            Reference WAV
            <input
              name="file"
              type="file"
              accept=".wav,audio/wav"
              required
              className="block mt-1"
            />
          </label>
          <label className="block">
            Transcript (optional)
            <input
              name="transcript"
              maxLength={4000}
              className="block w-full border rounded p-2 mt-1"
            />
          </label>
          <button disabled={busy} className="border rounded px-4 py-2 disabled:opacity-40">
            Save voice
          </button>
        </form>
        <section className="space-y-4">
          <label className="block">
            Voice
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="block w-full border rounded p-2 mt-1"
            >
              <option value="">Choose a saved voice</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Line
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
              rows={5}
              className="block w-full border rounded p-3 mt-1"
            />
          </label>
          <button
            disabled={busy || active || !voice || !text.trim()}
            onClick={generate}
            className="border rounded px-5 py-2 disabled:opacity-40"
          >
            {active ? "Generating…" : "Generate take"}
          </button>
          {active && (
            <button
              className="ml-3 underline"
              onClick={async () => {
                try {
                  setTake(
                    await json(await fetch(`/api/takes/${take!.id}/cancel`, { method: "POST" }))
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Cancel
            </button>
          )}
          {take && (
            <p role="status">
              Take: {take.status}
              {take.error_message ? ` — ${take.error_message}` : ""}
            </p>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--error)" }}>
              {error}
            </p>
          )}
          <AudioPlayer
            audioUrl={take?.status === "complete" ? `/api/takes/${take.id}/audio` : null}
          />
        </section>
      </main>
    </>
  );
}
