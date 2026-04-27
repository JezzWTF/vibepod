"use client";

import { useEffect, useRef } from "react";

interface StatusLogProps {
  messages: string[];
}

export default function StatusLog({ messages }: StatusLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      className="rounded-xl border p-5 flex flex-col gap-3"
      style={{ background: "var(--card-bg)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-2">
        <h2
          className="text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--accent-teal)" }}
        >
          Status Log
        </h2>
        <div className="flex gap-1 ml-auto">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 opacity-70" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 opacity-70" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 opacity-70" />
        </div>
      </div>

      <div
        className="rounded-lg p-4 h-40 overflow-y-auto font-mono text-xs leading-relaxed"
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>
            Waiting for input...
            <span className="animate-pulse">▌</span>
          </p>
        ) : (
          messages.map((msg, i) => {
            const isError =
              msg.toLowerCase().includes("error") ||
              msg.toLowerCase().includes("failed");
            const isSuccess =
              msg.toLowerCase().includes("done") ||
              msg.toLowerCase().includes("complete") ||
              msg.toLowerCase().includes("ready");
            const color = isError
              ? "var(--error)"
              : isSuccess
                ? "var(--success)"
                : "var(--foreground)";

            return (
              <div key={i} className="flex items-start gap-2">
                <span style={{ color: "var(--muted)" }} className="select-none">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ color }}>{msg}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
