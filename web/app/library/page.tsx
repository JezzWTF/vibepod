"use client";

import { useCallback, useEffect, useState } from "react";
import Header from "@/components/Header";
import GenerationCard from "@/components/GenerationCard";
import type { GenerationJob, GenerationsListResponse } from "@/lib/types/generation";

const PAGE_SIZE = 24;

export default function LibraryPage() {
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async (currentOffset: number, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/generations?limit=${PAGE_SIZE}&offset=${currentOffset}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as GenerationsListResponse;
      setJobs((prev) => (replace ? data.items : [...prev, ...data.items]));
      setHasMore(data.items.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load generations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs(0, true);
  }, [fetchJobs]);

  function handleDelete(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  function handleLoadMore() {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    fetchJobs(next, false);
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2
              className="text-xl font-bold tracking-tight"
              style={{ color: "var(--foreground)" }}
            >
              Generation Library
            </h2>
            <p className="text-sm mt-0.5" style={{ color: "var(--muted)" }}>
              Every completed generation is saved here.
            </p>
          </div>
          <a
            href="/"
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
            style={{
              background: "var(--accent-teal-dim)",
              borderColor: "transparent",
              color: "var(--accent-teal)",
            }}
          >
            + New Generation
          </a>
        </div>

        {/* Error state */}
        {error && (
          <div
            className="rounded-xl border px-4 py-3 text-sm mb-6"
            style={{
              background: "color-mix(in srgb, var(--error) 10%, transparent)",
              borderColor: "var(--error)",
              color: "var(--error)",
            }}
          >
            {error} —{" "}
            <button
              className="underline"
              onClick={() => fetchJobs(0, true)}
            >
              retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && jobs.length === 0 && !error && (
          <div
            className="rounded-xl border px-8 py-16 text-center"
            style={{ borderColor: "var(--border)", borderStyle: "dashed" }}
          >
            <p className="text-4xl mb-4">🎙</p>
            <p className="font-semibold mb-1" style={{ color: "var(--foreground)" }}>
              No generations yet
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              Generate some audio and it will appear here automatically.
            </p>
            <a
              href="/"
              className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: "var(--accent-teal-dim)",
                color: "var(--accent-teal)",
              }}
            >
              Go generate something
            </a>
          </div>
        )}

        {/* Grid */}
        {jobs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobs.map((job) => (
              <GenerationCard key={job.id} job={job} onDelete={handleDelete} />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasMore && !loading && jobs.length > 0 && (
          <div className="mt-8 text-center">
            <button
              onClick={handleLoadMore}
              className="px-6 py-2 rounded-lg text-sm font-medium border transition-colors"
              style={{
                background: "transparent",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            >
              Load more
            </button>
          </div>
        )}

        {/* Loading spinner */}
        {loading && (
          <div className="mt-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            Loading…
          </div>
        )}
      </main>
    </div>
  );
}
