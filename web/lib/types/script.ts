export type ScriptProviderId = "claude" | "codex" | "ollama";
export type ScriptProvider = {
  id: ScriptProviderId;
  name: string;
  state: "ready" | "signed_out" | "missing" | "offline";
  models: string[];
};
export type ScriptJobStatus = "queued" | "running" | "done" | "error" | "cancelled";
export type ScriptBrief = {
  topic: string;
  minutes: number;
  speakers: string[];
  tone: string;
  angle: string;
  notes: string;
};
export type ScriptJob = {
  id: string;
  status: ScriptJobStatus;
  stage: string | null;
  step: number;
  total: number;
  provider: ScriptProviderId;
  model: string | null;
  review: boolean;
  target: "new" | "this";
  brief: ScriptBrief;
  title: string | null;
  error: string | null;
  timings: Record<string, number>;
  research: { done: boolean; sources: number };
  outline: { done: boolean; sections: number };
  drafted: number;
  blocks: number;
  lines: string[];
};
export type ScriptRequest = ScriptBrief & {
  provider: ScriptProviderId;
  model: string | null;
  review: boolean;
  target: "new" | "this";
};
