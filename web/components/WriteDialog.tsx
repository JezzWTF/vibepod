"use client";
import { useEffect, useRef, useState } from "react";
import type { useScriptJob } from "@/hooks/useScriptJob";
import type { ScriptJob, ScriptProvider, ScriptProviderId } from "@/lib/types/script";

type Script = ReturnType<typeof useScriptJob>;
const LENGTHS = [3, 5, 10, 15, 20, 30];
const STATE_LABEL: Record<ScriptProvider["state"], string> = {
  ready: "Ready",
  signed_out: "Signed out",
  missing: "Not installed",
  offline: "Not running",
};
const FIX: Record<ScriptProvider["state"], string> = {
  ready: "",
  signed_out: "Sign in to the command-line tool, then check again.",
  missing: "The command-line tool is not installed.",
  offline: "Start Ollama, then check again.",
};

function clock(seconds?: number) {
  if (seconds === undefined) return "";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Steps({ job }: { job: ScriptJob }) {
  const active = job.status === "queued" || job.status === "running";
  const failed = job.status === "error" || job.status === "cancelled";
  const finished = job.status === "done";
  const at = (stage: string) => (job.stage === stage && active ? "active" : "pending");
  const stop = (stage: string) => (failed && job.stage === stage ? "fail" : null);
  const rows: { name: string; state: string; meta: string; time?: number; bar?: boolean }[] = [];
  if (job.research.done || job.provider !== "ollama")
    rows.push({
      name: "Research",
      state: job.research.done ? "done" : (stop("Researching") ?? at("Researching")),
      meta: job.research.done ? `${job.research.sources} sources collected` : "",
      time: job.timings.Researching,
    });
  rows.push({
    name: "Outline",
    state: job.outline.done ? "done" : (stop("Outlining") ?? at("Outlining")),
    meta: job.outline.done ? `${job.outline.sections} sections` : "",
    time: job.timings.Outlining,
  });
  const sections = job.outline.sections;
  rows.push({
    name: "Drafting",
    state: finished
      ? "done"
      : job.outline.done
        ? failed
          ? "fail"
          : active
            ? "active"
            : "pending"
        : "pending",
    meta: !job.outline.done
      ? ""
      : finished
        ? `${job.blocks} blocks`
        : `Section ${Math.min(job.drafted + 1, sections)} of ${sections}`,
    time: job.timings.Drafting,
    bar: job.outline.done && !!sections,
  });
  if (job.review)
    rows.push({
      name: "Review",
      state: finished ? "done" : job.stage === "Reviewing" && active ? "active" : "pending",
      meta: finished ? "Each section checked against the research" : "",
      time: job.timings.Reviewing,
    });
  const drafted = finished ? sections : job.drafted;
  return (
    <ol className="write-steps">
      {rows.map((row) => (
        <li key={row.name} className={row.state}>
          <span className="write-dot" aria-hidden>
            {row.state === "done" ? "✓" : row.state === "fail" ? "!" : ""}
          </span>
          <div>
            <div className="write-step-name">{row.name}</div>
            {row.meta && <div className="write-step-meta">{row.meta}</div>}
            {row.bar && (
              <div
                className="write-bar"
                role="progressbar"
                aria-label="Sections written"
                aria-valuenow={drafted}
                aria-valuemax={sections}
              >
                <span style={{ width: `${(drafted / sections) * 100}%` }} />
              </div>
            )}
          </div>
          <span className="write-step-time">{clock(row.time)}</span>
        </li>
      ))}
    </ol>
  );
}

function Lines({ lines }: { lines: string[] }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines.length]);
  if (!lines.length) return null;
  return (
    <div className="write-live" ref={box} aria-label="Script so far" aria-live="polite">
      {lines.map((line, i) => {
        const cut = line.indexOf(":");
        return (
          <p key={`${i}-${line.slice(0, 20)}`}>
            <b>{line.slice(0, cut)}</b>
            {line.slice(cut + 1).trim()}
          </p>
        );
      })}
    </div>
  );
}

export default function WriteDialog({
  open,
  onClose,
  script,
  canAppend,
  onOpenEpisode,
}: {
  open: boolean;
  onClose: () => void;
  script: Script;
  canAppend: boolean;
  onOpenEpisode: () => Promise<boolean>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { job, providers, busy, error } = script;
  const [topic, setTopic] = useState(""),
    [minutes, setMinutes] = useState(10),
    [tone, setTone] = useState("Warm, curious and conversational"),
    [speakers, setSpeakers] = useState(["Alice", "Frank"]),
    [newSpeaker, setNewSpeaker] = useState<string | null>(null),
    [provider, setProvider] = useState<ScriptProviderId>("claude"),
    [model, setModel] = useState(""),
    [angle, setAngle] = useState(""),
    [notes, setNotes] = useState(""),
    [review, setReview] = useState(false),
    [target, setTarget] = useState<"new" | "this">("new"),
    [resumeWith, setResumeWith] = useState<ScriptProviderId | null>(null);
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
      script.checkProviders();
    } else dialog.current?.close();
  }, [open]);
  const chosen = providers.find((p) => p.id === provider);
  const blocked = chosen ? chosen.state !== "ready" : false;
  const needsModel = provider === "ollama";
  const ready = !!topic.trim() && !blocked && !busy && (!needsModel || !!model.trim());
  const heading = !job
    ? "Write with AI"
    : job.status === "done"
      ? "Script ready"
      : job.status === "error" || job.status === "cancelled"
        ? "Writing stopped"
        : "Writing your script";
  const sub = !job
    ? "Describe the topic. The agent researches it and writes a script you can edit."
    : job.status === "done"
      ? (job.title ?? job.brief.topic)
      : job.brief.topic;
  const stopped = job?.status === "error" || job?.status === "cancelled";
  const resumeProvider = resumeWith ?? job?.provider ?? "claude";

  return (
    <dialog
      ref={dialog}
      className="studio-dialog write-dialog"
      aria-labelledby="write-title"
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <div>
          <h2 id="write-title">{heading}</h2>
          <p>{sub}</p>
        </div>
        <button aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dialog-body write-body">
        {!job && (
          <>
            <label>
              Topic
              <textarea
                autoFocus
                value={topic}
                maxLength={600}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <div className="write-row">
              <label>
                Length
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
                <small>About {Math.round((minutes * 150) / 40)} blocks</small>
              </label>
              <label>
                Tone
                <input value={tone} maxLength={200} onChange={(e) => setTone(e.target.value)} />
              </label>
            </div>
            <div>
              <span className="write-label">Speakers</span>
              <div className="write-speakers">
                {speakers.map((s) => (
                  <span key={s} className="write-speaker">
                    {s}
                    <button
                      aria-label={`Remove ${s}`}
                      disabled={speakers.length === 1}
                      onClick={() => setSpeakers(speakers.filter((x) => x !== s))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {newSpeaker === null ? (
                  <button
                    className="write-speaker write-add"
                    disabled={speakers.length >= 4}
                    onClick={() => setNewSpeaker("")}
                  >
                    + Add speaker
                  </button>
                ) : (
                  <input
                    className="write-new-speaker"
                    aria-label="New speaker name"
                    autoFocus
                    value={newSpeaker}
                    maxLength={38}
                    onChange={(e) => setNewSpeaker(e.target.value.replace(":", ""))}
                    onBlur={() => setNewSpeaker(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setNewSpeaker(null);
                      }
                      const name = newSpeaker.trim();
                      if (
                        e.key === "Enter" &&
                        name &&
                        !speakers.some((s) => s.toLowerCase() === name.toLowerCase())
                      ) {
                        setSpeakers([...speakers, name]);
                        setNewSpeaker(null);
                      }
                    }}
                  />
                )}
              </div>
            </div>
            <div>
              <span className="write-label" id="write-model">
                Model
              </span>
              <div className="write-seg" role="radiogroup" aria-labelledby="write-model">
                {(providers.length
                  ? providers
                  : (["claude", "codex", "ollama"] as const).map((id) => ({
                      id,
                      name: id[0].toUpperCase() + id.slice(1),
                      state: "ready" as const,
                      models: [],
                    }))
                ).map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={provider === p.id}
                    onClick={() => setProvider(p.id)}
                  >
                    <strong>{p.name}</strong>
                    <span className={`write-state ${p.state === "ready" ? "" : "off"}`}>
                      <i />
                      {providers.length ? STATE_LABEL[p.state] : "Checking"}
                    </span>
                  </button>
                ))}
              </div>
              {blocked && chosen && (
                <p className="write-notice" role="alert">
                  {chosen.name} is {STATE_LABEL[chosen.state].toLowerCase()}. {FIX[chosen.state]}{" "}
                  <button onClick={() => script.checkProviders()}>Check again</button>
                </p>
              )}
              {needsModel && (
                <label className="write-spaced">
                  Ollama model
                  <input
                    list="ollama-models"
                    placeholder="llama3.1"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <datalist id="ollama-models">
                    {chosen?.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <small>Ollama cannot search the web. Add your own notes below.</small>
                </label>
              )}
            </div>
            <details open={needsModel}>
              <summary>Angle and your own notes</summary>
              <label className="write-spaced">
                Angle
                <input
                  value={angle}
                  maxLength={400}
                  placeholder="For example: a sceptic meets a baker"
                  onChange={(e) => setAngle(e.target.value)}
                />
              </label>
              <label className="write-spaced">
                Notes
                <textarea
                  value={notes}
                  placeholder="Facts, links or points you want included"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </details>
            <label className="write-check">
              <input
                type="checkbox"
                checked={review}
                onChange={(e) => setReview(e.target.checked)}
              />
              <span>
                Review each section for accuracy
                <small>Slower and uses more of your plan.</small>
              </span>
            </label>
            <div>
              <span className="write-label" id="write-target">
                Add to
              </span>
              <div className="write-seg" role="radiogroup" aria-labelledby="write-target">
                <button
                  role="radio"
                  aria-checked={target === "new"}
                  onClick={() => setTarget("new")}
                >
                  <strong>New episode</strong>
                </button>
                <button
                  role="radio"
                  aria-checked={target === "this" && canAppend}
                  disabled={!canAppend}
                  onClick={() => setTarget("this")}
                >
                  <strong>This episode</strong>
                  <span className="write-step-meta">Appends after the last block</span>
                </button>
              </div>
            </div>
          </>
        )}
        {job && (
          <>
            {stopped && (
              <p className="write-notice" role="alert">
                {job.status === "cancelled" ? "Cancelled." : (job.error ?? "Something went wrong.")}{" "}
                {job.drafted
                  ? `Sections 1–${job.drafted} are saved.`
                  : job.research.done
                    ? "Research is saved."
                    : ""}
              </p>
            )}
            {job.status === "done" && (
              <div className="write-summary">
                <div>
                  <strong>{job.blocks}</strong>
                  <span>blocks</span>
                </div>
                <div>
                  <strong>{job.brief.minutes} min</strong>
                  <span>of speech</span>
                </div>
                <div>
                  <strong>{job.research.sources}</strong>
                  <span>sources</span>
                </div>
              </div>
            )}
            <Steps job={job} />
            {job.status !== "done" && <Lines lines={job.lines} />}
            {stopped && (
              <div>
                <span className="write-label" id="write-resume">
                  Continue with
                </span>
                <div className="write-seg" role="radiogroup" aria-labelledby="write-resume">
                  {providers
                    .filter((p) => p.id !== "ollama" || job.brief.notes)
                    .map((p) => (
                      <button
                        key={p.id}
                        role="radio"
                        aria-checked={resumeProvider === p.id}
                        disabled={p.state !== "ready"}
                        onClick={() => setResumeWith(p.id)}
                      >
                        <strong>{p.name}</strong>
                        <span className={`write-state ${p.state === "ready" ? "" : "off"}`}>
                          <i />
                          {STATE_LABEL[p.state]}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="studio-dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        {!job && (
          <>
            <span />
            <div>
              <button onClick={onClose}>Cancel</button>
              <button
                className="studio-primary"
                disabled={!ready}
                onClick={async () => {
                  await script.start({
                    topic: topic.trim(),
                    minutes,
                    speakers,
                    tone,
                    angle,
                    notes,
                    provider,
                    model: needsModel ? model.trim() : null,
                    review,
                    target: target === "this" && canAppend ? "this" : "new",
                  });
                }}
              >
                Write script
              </button>
            </div>
          </>
        )}
        {job && (job.status === "queued" || job.status === "running") && (
          <>
            <span className="studio-muted">
              {job.provider[0].toUpperCase() + job.provider.slice(1)} ·{" "}
              {job.review ? "with review" : "no review"}
            </span>
            <div>
              <button onClick={onClose}>Keep working</button>
              <button className="write-danger" disabled={busy} onClick={() => script.cancel()}>
                Cancel
              </button>
            </div>
          </>
        )}
        {stopped && (
          <>
            <button className="write-danger" disabled={busy} onClick={() => script.discard()}>
              Discard
            </button>
            <div>
              <button onClick={onClose}>Close</button>
              <button
                className="studio-primary"
                disabled={busy || providers.find((p) => p.id === resumeProvider)?.state !== "ready"}
                onClick={() =>
                  script.resume(resumeProvider, resumeProvider === job.provider ? job.model : null)
                }
              >
                Resume
              </button>
            </div>
          </>
        )}
        {job?.status === "done" && (
          <>
            <button className="write-danger" disabled={busy} onClick={() => script.discard()}>
              Discard
            </button>
            <div>
              <button onClick={onClose}>Close</button>
              <button
                className="studio-primary"
                disabled={busy}
                onClick={async () => {
                  if (await onOpenEpisode()) onClose();
                }}
              >
                {job.target === "this" ? "Add to episode" : "Open episode"}
              </button>
            </div>
          </>
        )}
      </footer>
    </dialog>
  );
}
