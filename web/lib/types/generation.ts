export type GenerationStatus = "generating" | "complete" | "error" | "cancelled";

export interface GenerationJob {
  id: string;
  created_at: string;
  status: GenerationStatus;
  script: string;
  speaker: string;
  cfg_scale: number;
  inference_steps: number | null;
  duration_secs: number | null;
  sample_rate: number | null;
  audio_path: string | null;
  waveform_path: string | null;
  error_message: string | null;
}

export interface WaveformPeaks {
  sampleRate: number;
  durationSecs: number;
  channels: number;
  samplesPerPixel: number;
  length: number;
  data: {
    min: number[];
    max: number[];
  };
}

export interface GenerationsListResponse {
  items: GenerationJob[];
  limit: number;
  offset: number;
}
