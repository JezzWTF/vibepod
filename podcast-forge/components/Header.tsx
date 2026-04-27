"use client";

import { useEffect, useState } from "react";

type ServerStatus = "checking" | "online" | "offline";

export default function Header() {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        setStatus(data.status === "online" ? "online" : "offline");
      } catch {
        setStatus("offline");
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const statusConfig = {
    checking: {
      color: "bg-yellow-500",
      label: "Checking...",
      textColor: "text-yellow-400",
      pulse: true,
    },
    online: {
      color: "bg-green-500",
      label: "Server Online",
      textColor: "text-green-400",
      pulse: false,
    },
    offline: {
      color: "bg-red-500",
      label: "Server Offline",
      textColor: "text-red-400",
      pulse: false,
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border"
        style={{
          background: "var(--background)",
          borderColor: "var(--border)",
        }}
      >
        <span className="relative flex h-2 w-2">
          <span
            className={`${cfg.pulse ? "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 " + cfg.color : "hidden"}`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${cfg.color}`}
          />
        </span>
        <span style={{ color: "var(--foreground)" }}>{cfg.label}</span>
      </div>
    </header>
  );
}
