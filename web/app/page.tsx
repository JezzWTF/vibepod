"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import AudioPlayer from "@/components/AudioPlayer";

type Voice = { id: string; name: string };
type Block = { id?: string; speaker: string; voice_id: string; text: string };
type Take = { id: string; status: string; error_message: string | null };
type Episode = { id: string; title: string; blocks: Block[] };
async function read(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? data.error ?? "Request failed");
  return data;
}
const blank = (speaker = "Host"): Block => ({ speaker, voice_id: "", text: "" });

export default function StudioPage() {
  const [voices, setVoices] = useState<Voice[]>([]),
    [episode, setEpisode] = useState<Episode | null>(null);
  const [title, setTitle] = useState("Untitled episode"),
    [blocks, setBlocks] = useState<Block[]>([blank("Host"), blank("Guest")]);
  const [takes, setTakes] = useState<Record<string, Take>>({}),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/voices")
      .then(read)
      .then(setVoices)
      .catch((e) => setError(e.message));
  }, []);
  const selectedAudio = useMemo(() => {
    const id = Object.values(takes).find((take) => take.status === "complete")?.id;
    return id ? `/api/takes/${id}/audio` : null;
  }, [takes]);
  function editBlock(index: number, changes: Partial<Block>) {
    setBlocks((current) =>
      current.map((block, i) => (i === index ? { ...block, ...changes } : block))
    );
  }
  async function saveEpisode() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(episode ? `/api/episodes/${episode.id}` : "/api/episodes", {
        method: episode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, blocks }),
      });
      const saved = await read(response);
      setEpisode(saved);
      setBlocks(saved.blocks);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function generate(index: number) {
    const block = blocks[index];
    if (!episode || !block.id || !block.voice_id || !block.text.trim()) return;
    setError("");
    try {
      const take = await read(
        await fetch("/api/takes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: block.text,
            voice_id: block.voice_id,
            episode_id: episode.id,
            block_id: block.id,
          }),
        })
      );
      setTakes((current) => ({ ...current, [block.id!]: take }));
      const timer = setInterval(async () => {
        const updated = await read(await fetch(`/api/takes/${take.id}`));
        setTakes((current) => ({ ...current, [block.id!]: updated }));
        if (!["queued", "generating"].includes(updated.status)) clearInterval(timer);
      }, 1500);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p
              className="text-sm uppercase tracking-widest"
              style={{ color: "var(--accent-teal)" }}
            >
              Studio
            </p>
            <h1 className="text-3xl font-semibold">Build an episode from the script</h1>
            <p className="mt-2 text-sm">
              Each block keeps its own take. Regenerate a line without rebuilding the conversation.
            </p>
          </div>
          <button
            onClick={saveEpisode}
            disabled={saving}
            className="border rounded px-4 py-2 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save episode"}
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded p-3 text-lg"
          aria-label="Episode title"
        />
        <section className="space-y-3">
          {blocks.map((block, index) => (
            <article
              key={block.id ?? index}
              className="rounded-xl border p-4 space-y-3"
              style={{ borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Block {index + 1}</span>
                <button
                  onClick={() => setBlocks((current) => current.filter((_, i) => i !== index))}
                  className="text-sm underline"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={block.speaker}
                  onChange={(e) => editBlock(index, { speaker: e.target.value })}
                  placeholder="Speaker name"
                  className="border rounded p-2"
                  aria-label={`Speaker ${index + 1}`}
                />
                <select
                  value={block.voice_id}
                  onChange={(e) => editBlock(index, { voice_id: e.target.value })}
                  className="border rounded p-2"
                  aria-label={`Voice ${index + 1}`}
                >
                  <option value="">Assign a voice</option>
                  {voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={block.text}
                onChange={(e) => editBlock(index, { text: e.target.value })}
                rows={3}
                placeholder="Write this line…"
                className="w-full border rounded p-3"
                aria-label={`Script line ${index + 1}`}
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => generate(index)}
                  disabled={!episode || !block.id || !block.voice_id || !block.text.trim()}
                  className="border rounded px-3 py-2 disabled:opacity-40"
                >
                  {takes[block.id ?? ""]?.status === "generating" ? "Generating…" : "Generate take"}
                </button>
                {takes[block.id ?? ""] && (
                  <span className="text-sm" role="status">
                    {takes[block.id ?? ""].status}
                  </span>
                )}
              </div>
            </article>
          ))}
        </section>
        <button
          onClick={() =>
            setBlocks((current) => [...current, blank(current.length % 2 ? "Guest" : "Host")])
          }
          className="border rounded px-4 py-2"
        >
          + Add script block
        </button>
        {selectedAudio && (
          <section className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <h2 className="font-semibold mb-3">Selected takes</h2>
            <AudioPlayer audioUrl={selectedAudio} />
          </section>
        )}
        {error && (
          <p role="alert" style={{ color: "var(--error)" }}>
            {error}
          </p>
        )}
        {!episode && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Save the episode once to create its persistent blocks, then generate each assigned line.
          </p>
        )}
      </main>
    </>
  );
}
