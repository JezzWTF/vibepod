import type { GenerationJob } from "./generation";
export type Voice = { id: string; name: string; kind: string };
export type ScriptBlock = {
  id?: string;
  speaker: string;
  voice_id: string | null;
  text: string;
  selected_take_id: string | null;
  takes: GenerationJob[];
  stale: boolean;
};
export type Episode = {
  id: string;
  title: string;
  revision: number;
  gap_secs: number;
  blocks: ScriptBlock[];
};
export type EpisodeSummary = { id: string; title: string; block_count: number; updated_at: string };
