"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export default function Header() {
  const [status, setStatus] = useState("checking");
  useEffect(() => {
    const check = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then((d) => setStatus(d.status))
        .catch(() => setStatus("offline"));
    check();
    const timer = setInterval(check, 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header
      className="border-b px-6 py-5 flex justify-between gap-4"
      style={{ borderColor: "var(--border)" }}
    >
      <Link href="/" className="font-semibold text-xl">
        VibePod Studio
      </Link>
      <nav className="flex gap-5 items-center">
        <Link href="/">Generate</Link>
        <Link href="/library">Library</Link>
        <span className="text-xs" role="status">
          Qwen · {status}
        </span>
      </nav>
    </header>
  );
}
