"use client";

import { useEffect, useRef, useState } from "react";

type ServerStatus = "checking" | "downloading" | "loading" | "online" | "error" | "offline";

// Polling intervals: poll quickly until the server is online, then slow down.
const FAST_INTERVAL_MS = 3000;   // while checking / loading
const SLOW_INTERVAL_MS = 30000;  // once online

export default function Header() {
  const [status, setStatus] = useState<ServerStatus>("checking");
  const [message, setMessage] = useState<string | undefined>();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json();
        const newStatus: ServerStatus = (data.status as ServerStatus) ?? "offline";
        setStatus(newStatus);
        setMessage(data.message);

        // Switch to slow polling once we know the server is online
        if (newStatus === "online" && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(checkHealth, SLOW_INTERVAL_MS);
        }
        // Switch to fast polling if we detect the server went offline/loading
        if ((newStatus === "offline" || newStatus === "downloading" || newStatus === "loading") && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(checkHealth, FAST_INTERVAL_MS);
        }
      } catch {
        setStatus("offline");
        setMessage(undefined);
      }
    };

    // Start with a fast poll — the server may still be loading the model
    checkHealth();
    intervalRef.current = setInterval(checkHealth, FAST_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const statusConfig: Record<
    ServerStatus,
    { color: string; label: string; pulse: boolean; ring: string }
  > = {
    checking: {
      color: "bg-yellow-500",
      label: "Checking…",
      pulse: true,
      ring: "border-yellow-500/30",
    },
    loading: {
      color: "bg-blue-400",
      label: "Loading model…",
      pulse: true,
      ring: "border-blue-400/30",
    },
    downloading: {
      color: "bg-sky-400",
      label: "Downloading model…",
      pulse: true,
      ring: "border-sky-400/30",
    },
    online: {
      color: "bg-green-500",
      label: "Server Online",
      pulse: false,
      ring: "border-green-500/30",
    },
    error: {
      color: "bg-orange-500",
      label: "Model Error",
      pulse: false,
      ring: "border-orange-500/30",
    },
    offline: {
      color: "bg-red-500",
      label: "Server Offline",
      pulse: false,
      ring: "border-red-500/30",
    },
  };

  const cfg = statusConfig[status];

  return (
    <header
      className="border-b px-6 py-4 flex items-center justify-between"
      style={{
        background: "var(--card-bg)",
        borderColor: "var(--border)",
      }}
    >
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-lg font-bold"
            style={{
              background:
                "linear-gradient(135deg, var(--accent-teal-dim), var(--accent-violet-dim))",
            }}
          >
            🎙
          </div>
          <div>
            <h1
              className="text-xl font-bold tracking-tight"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-teal), var(--accent-violet))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              VibePod
            </h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Powered by VibeVoice 0.5B
            </p>
          </div>
        </div>
      </div>

      <div
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${cfg.ring}`}
        style={{
          background: "var(--background)",
          borderColor: "var(--border)",
        }}
        title={message}
      >
        <span className="relative flex h-2 w-2">
          {cfg.pulse && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.color}`}
            />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${cfg.color}`}
          />
        </span>
        <span style={{ color: "var(--foreground)" }}>{cfg.label}</span>
      </div>
    </header>
  );
}

