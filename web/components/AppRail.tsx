"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import GuardedLink from "./GuardedLink";

const ITEMS = [
  { href: "/", label: "Studio", path: "M4 5h16M4 12h16M4 19h10" },
  {
    href: "/library",
    label: "Library",
    path: "M5 4v16M10 4v16M15 5l4 15",
  },
  {
    href: "/voices",
    label: "Voices",
    path: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  },
];

export default function AppRail() {
  const pathname = usePathname();
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
    <nav className="app-rail" aria-label="VibePod">
      <GuardedLink href="/" className="app-rail-brand" aria-label="VibePod Studio">
        <span className="studio-mark">▥</span>
      </GuardedLink>
      <ul>
        {ITEMS.map(({ href, label, path }) => {
          const current = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <GuardedLink href={href} aria-current={current ? "page" : undefined}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d={path} />
                </svg>
                {label}
              </GuardedLink>
            </li>
          );
        })}
      </ul>
      <div className="app-rail-footer">
        <span role="status" className={`app-rail-status is-${status}`}>
          <i />
          {status === "online" ? "Engine on" : status === "checking" ? "Checking" : "Engine off"}
        </span>
        <span>{process.env.NEXT_PUBLIC_VIBEPOD_VERSION}</span>
      </div>
    </nav>
  );
}
