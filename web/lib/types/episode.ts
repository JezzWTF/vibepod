import type { GenerationJob } from "./generation";
export const MAX_BLOCKS = 500;
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
  sources: string;
  blocks: ScriptBlock[];
};
export type EpisodeState = "active" | "archived" | "trashed";
export type EpisodeAction = "archive" | "trash" | "restore";
export type EpisodeCounts = Record<EpisodeState, number>;
export type EpisodeSummary = {
  id: string;
  title: string;
  block_count: number;
  updated_at: string;
  revision: number;
  lifecycle: EpisodeState;
};
