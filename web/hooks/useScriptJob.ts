"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  ScriptJob,
  ScriptProvider,
  ScriptProviderId,
  ScriptRequest,
} from "@/lib/types/script";
import type { Episode } from "@/lib/types/episode";

const ACTIVE = ["queued", "running"];

export function useScriptJob() {
  const [job, setJob] = useState<ScriptJob | null>(null);
  const [providers, setProviders] = useState<ScriptProvider[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const current: ScriptJob | null = await api("script-jobs/current");
      if (mounted.current) setJob(current);
    } catch {
      // The Studio header already reports an unreachable server.
    }
  }, []);
  const checkProviders = useCallback(async () => {
    try {
      const data: { items: ScriptProvider[] } = await api("script-providers");
      if (mounted.current) setProviders(data.items);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const running = !!job && ACTIVE.includes(job.status);
  useEffect(() => {
    if (!running || !job) return;
    const timer = setInterval(async () => {
      try {
        const next: ScriptJob = await api(`script-jobs/${job.id}`);
        if (mounted.current) setJob(next);
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [running, job?.id]);

  async function run<T>(work: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const start = (request: ScriptRequest) =>
    run(async () => setJob(await api("script-jobs", "POST", request)));
  const cancel = () =>
    run(async () => job && setJob(await api(`script-jobs/${job.id}/cancel`, "POST")));
  const resume = (provider?: ScriptProviderId, model?: string | null) =>
    run(
      async () =>
        job && setJob(await api(`script-jobs/${job.id}/resume`, "POST", { provider, model }))
    );
  const discard = () =>
    run(async () => {
      if (!job) return;
      await api(`script-jobs/${job.id}/discard`, "POST");
      setJob(null);
    });
  const apply = (episodeId?: string, revision?: number) =>
    run(async () => {
      if (!job) return null;
      const episode: Episode = await api(`script-jobs/${job.id}/apply`, "POST", {
        episode_id: episodeId,
        revision,
      });
      setJob(null);
      return episode;
    });

  return {
    job,
    providers,
    error,
    busy,
    running,
    checkProviders,
    start,
    cancel,
    resume,
    discard,
    apply,
    clearError: () => setError(""),
  };
}
