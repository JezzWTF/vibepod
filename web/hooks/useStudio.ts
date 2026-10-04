"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Episode, EpisodeSummary, Voice, ScriptBlock } from "@/lib/types/episode";

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : (data.detail?.[0]?.msg ?? data.error ?? "Request failed")
    );
  return data;
}

export function useStudio() {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [recent, setRecent] = useState<EpisodeSummary[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading workspace");
  const [busy, setBusy] = useState(false);
  const draft = useRef<Episode | null>(null);
  const version = useRef(0),
    savedVersion = useRef(0);
  const saveTask = useRef<Promise<Episode | null> | null>(null);
  const mounted = useRef(true);
  const actionRunning = useRef(false);
  const install = useCallback((value: Episode) => {
    draft.current = value;
    setEpisode(value);
  }, []);
  const refreshRecent = useCallback(async () => setRecent((await api("episodes")).items), []);

  useEffect(() => {
    mounted.current = true;
    Promise.all([api("episodes"), api("voices")])
      .then(async ([list, voiceList]) => {
        setRecent(list.items);
        setVoices(voiceList);
        setStatus("Ready");
        const requested = new URLSearchParams(window.location.search).get("episode");
        const last = requested ?? localStorage.getItem("vibepod:last-episode");
        if (last && list.items.some((e: EpisodeSummary) => e.id === last)) {
          install(await api(`episodes/${encodeURIComponent(last)}`));
          setStatus("Saved");
        }
      })
      .catch((e) => {
        setError(e.message);
        setStatus("Offline");
      });
    return () => {
      mounted.current = false;
    };
  }, [install]);

  function edit(changes: Partial<Episode>) {
    if (!draft.current || actionRunning.current) return;
    version.current++;
    setStatus("Unsaved changes");
    install({ ...draft.current, ...changes });
  }
  async function save(): Promise<Episode | null> {
    if (saveTask.current) {
      await saveTask.current;
      return save();
    }
    if (!draft.current || version.current === savedVersion.current) return draft.current;
    const snapshot = draft.current,
      snapshotVersion = version.current;
    setStatus("Saving…");
    const task = (async () => {
      try {
        const saved: Episode = await api(`episodes/${snapshot.id}`, "PUT", snapshot);
        setError("");
        if (draft.current?.id !== snapshot.id) return draft.current;
        savedVersion.current = snapshotVersion;
        if (version.current === snapshotVersion) {
          install(saved);
          setStatus("Saved");
        } else {
          install({
            ...draft.current,
            revision: saved.revision,
            blocks: draft.current.blocks.map((b, i) => ({ ...b, id: b.id ?? saved.blocks[i]?.id })),
          });
          setStatus("Unsaved changes");
        }
        refreshRecent().catch(() => {});
        return draft.current;
      } catch (e) {
        setError((e as Error).message);
        setStatus("Save failed");
        throw e;
      }
    })();
    saveTask.current = task;
    try {
      return await task;
    } finally {
      saveTask.current = null;
    }
  }
  useEffect(() => {
    if (!episode || version.current === savedVersion.current) return;
    const timer = setTimeout(() => {
      save().catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [episode]);

  useEffect(() => {
    if (!episode) return;
    const id = episode.id;
    const timer = setInterval(async () => {
      if (version.current !== savedVersion.current || saveTask.current || actionRunning.current)
        return;
      const requestVersion = version.current;
      const requestRevision = draft.current?.revision;
      try {
        const value = await api(`episodes/${id}`);
        if (
          mounted.current &&
          draft.current?.id === id &&
          version.current === savedVersion.current &&
          version.current === requestVersion &&
          draft.current.revision === requestRevision &&
          !saveTask.current &&
          !actionRunning.current
        ) {
          install(value);
          setError("");
        }
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [episode?.id, install]);

  async function action(work: () => Promise<void>) {
    if (actionRunning.current) return;
    actionRunning.current = true;
    setError("");
    setBusy(true);
    try {
      await save();
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  }
  function open(id: string) {
    return action(async () => {
      install(await api(`episodes/${id}`));
      localStorage.setItem("vibepod:last-episode", id);
      window.history.replaceState(null, "", `/?episode=${encodeURIComponent(id)}`);
      version.current = 0;
      savedVersion.current = 0;
      setStatus("Saved");
    });
  }
  function create() {
    return action(async () => {
      install(
        await api("episodes", "POST", { title: "Untitled episode", blocks: [], gap_secs: 0.25 })
      );
      version.current = 0;
      savedVersion.current = 0;
      setStatus("Saved");
      await refreshRecent();
      if (draft.current) localStorage.setItem("vibepod:last-episode", draft.current.id);
      if (draft.current)
        window.history.replaceState(null, "", `/?episode=${encodeURIComponent(draft.current.id)}`);
    });
  }
  function block(index: number, changes: Partial<ScriptBlock>) {
    if (draft.current)
      edit({
        blocks: draft.current.blocks.map((b, i) => (i === index ? { ...b, ...changes } : b)),
      });
  }
  function voice(speaker: string, id: string) {
    if (draft.current)
      edit({
        blocks: draft.current.blocks.map((b) =>
          b.speaker === speaker ? { ...b, voice_id: id || null } : b
        ),
      });
  }
  function add() {
    if (draft.current)
      edit({
        blocks: [
          ...draft.current.blocks,
          {
            speaker: draft.current.blocks.at(-1)?.speaker ?? "Host",
            voice_id: draft.current.blocks.at(-1)?.voice_id ?? null,
            text: "",
            selected_take_id: null,
            takes: [],
            stale: false,
          },
        ],
      });
  }
  function importScript(text: string) {
    if (!draft.current || actionRunning.current) return false;
    const parsed: ScriptBlock[] = [];
    const cast = Object.fromEntries(draft.current.blocks.map((b) => [b.speaker, b.voice_id]));
    for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
      const match = /^([^:]{1,80}):\s*(.+)$/.exec(line);
      if (!match) {
        setError("Use Speaker: line, with each speech block on its own line.");
        return false;
      }
      parsed.push({
        speaker: match[1].trim(),
        text: match[2].trim(),
        voice_id: cast[match[1].trim()] ?? null,
        takes: [],
        stale: false,
        selected_take_id: null,
      });
    }
    if (!parsed.length || parsed.length + draft.current.blocks.length > 100) {
      setError("Import between 1 and 100 blocks in total.");
      return false;
    }
    setError("");
    edit({ blocks: [...draft.current.blocks, ...parsed] });
    return true;
  }
  function generate(bid?: string, mode = "missing") {
    return action(async () => {
      if (!draft.current) return;
      await api(
        `episodes/${draft.current.id}/${bid ? `blocks/${bid}/generate` : `generate?mode=${mode}`}`,
        "POST"
      );
      install(await api(`episodes/${draft.current.id}`));
    });
  }
  function select(bid: string, tid: string) {
    return action(async () => {
      if (draft.current)
        install(
          await api(`episodes/${draft.current.id}/blocks/${bid}/select`, "POST", { take_id: tid })
        );
    });
  }
  function cancel() {
    return action(async () => {
      if (draft.current) install(await api(`episodes/${draft.current.id}/cancel`, "POST"));
    });
  }
  return {
    episode,
    recent,
    voices,
    error,
    status,
    busy,
    edit,
    block,
    voice,
    add,
    importScript,
    open,
    create,
    generate,
    select,
    cancel,
    save,
    refreshVoices: async () => setVoices(await api("voices")),
  };
}
