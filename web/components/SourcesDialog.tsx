"use client";
import { useEffect, useRef } from "react";

const URL_PATTERN = /(https?:\/\/[^\s)\]]+)/g;

function shorten(url: string) {
  const bare = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return bare.length > 48 ? `${bare.slice(0, 47)}…` : bare;
}

function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_PATTERN).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noreferrer noopener">
            {shorten(part)}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

export function sourceCount(sources: string) {
  return new Set(sources.match(URL_PATTERN) ?? []).size;
}

export default function SourcesDialog({
  open,
  onClose,
  title,
  sources,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sources: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const items = sources
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return (
    <dialog
      ref={dialog}
      className="studio-dialog sources-dialog"
      aria-labelledby="sources-title"
      onClose={onClose}
    >
      <header>
        <div>
          <h2 id="sources-title">Sources</h2>
          <p>{title}</p>
        </div>
        <button aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <ul className="dialog-body sources-list">
        {items.map((item, i) => (
          <li key={i}>
            <Linked text={item} />
          </li>
        ))}
      </ul>
    </dialog>
  );
}
