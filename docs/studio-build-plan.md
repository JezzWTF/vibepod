# VibePod Studio build plan

The script is the editor: each speaker line owns immutable takes, and a retake replaces the selected audio without rewriting the conversation. Local CUDA on RTX 4070 (12 GB) is the target.

## Phases

- Foundation: stable IDs, WAV assembly helper, cancellation, waveform peaks (retained).
- Phase 1: SQLite library and server-side audio (carried from the committed feat/studio branch).
- #17: model spike completed; Qwen3-TTS 12Hz 1.7B Base selected, VoiceDesign for reusable reference voices. See model-spike.md for measurements.
- #18: adapter boundary, GPU-only runtime, persistent line takes, cloning and library. This is the current implementation.
- #19: episode/cast/script-block editing, generate episode sequentially, select/compare takes, per-line regeneration, full episode playback, reopen persisted episodes.
- #20: WAV/MP3 export, loudness normalization, metadata.
- Later if wanted: timeline, music beds, SFX, intros, templates.

## Script and take contracts for #19

Retain stable IDs and source provenance from the prior plan; timeline clip IDs become optional future associations.

```ts
type ScriptDocument = { blocks: ScriptBlock[] };
type ScriptBlock = {
  id: string;
  speakerId: string;
  text: string;
  order: number;
  selectedTakeId: string | null;
  takeIds: string[];
};
type Take = {
  id: string;
  episodeId: string | null;
  scriptBlockId: string | null;
  voiceId: string;
  text: string;
  settings: { seed: number };
  modelId: string;
  status: "queued" | "generating" | "complete" | "error" | "cancelled";
  audioPath: string | null;
  waveformPath: string | null;
  durationSecs: number | null;
  sampleRate: number | null;
  createdAt: string;
};
```

Episode persistence and its relationships are planned for #19. Current standalone takes use the Phase 1 generations table, with additive provenance columns; existing rows remain playable. WAV and peaks stay immutable until deletion. Voice references are saved once, not redesigned per line.

## Runtime

`model_adapter.py`: synthesize(text, voice, settings) -> Audio, clone from a reference, optional design. All model imports stay here. Base and VoiceDesign swap rather than coexist in VRAM. SDPA is default.

`tts_server.py`: durable queue metadata, one GPU worker, cancellation, take/voice endpoints. A restart explicitly fails interrupted rows. Next proxies preserve status and audio range responses; the library retains playback/download/delete and waveform previews. Old tuning and streaming controls are removed.

## Acceptance

#18 is verified with real GPU inference through the HTTP adapter path, stored WAV/peaks, and the library. The complete #13 acceptance additionally needs #19 and #20; this rebuild does not claim episode editing or final podcast export.
