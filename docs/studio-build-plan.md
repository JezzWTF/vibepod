# VibePod Studio — Build Plan

**Version:** 1.0  
**Authors:** LyAhn + Claude (Anthropic) + Codex  
**Date:** 2026-05-02  
**Status:** Active

---

## Table of Contents

1. [Product Goal](#1-product-goal)
2. [Current Architecture](#2-current-architecture)
3. [Locked Technical Decisions](#3-locked-technical-decisions)
4. [Non-Goals](#4-non-goals)
5. [Data Models](#5-data-models)
6. [Storage Layout](#6-storage-layout)
7. [API Contract](#7-api-contract)
8. [Frontend Routes](#8-frontend-routes)
9. [Component Hierarchy](#9-component-hierarchy)
10. [Timeline Rendering Model](#10-timeline-rendering-model)
11. [Playback Model](#11-playback-model)
12. [Export Rendering Model](#12-export-rendering-model)
13. [Phase Breakdown](#13-phase-breakdown)
14. [Acceptance Criteria](#14-acceptance-criteria)
15. [Deferred Decisions](#15-deferred-decisions)
16. [Third-Party Library Policy](#16-third-party-library-policy)

---

## 1. Product Goal

VibePod becomes a **script-aware AI podcast creation studio** where users can generate, arrange, edit, regenerate, and export podcast episodes from written scripts.

The headline feature that differentiates VibePod from generic audio editors:

> Every generated clip knows where it came from in the script and can be regenerated, replaced, or compared — without touching the original audio file.

The existing fast-generation page stays as the quick path. Studio grows alongside it.

---

## 2. Current Architecture

### What exists today

| Layer | Details |
|---|---|
| Frontend | Next.js 15 · React 19 · TypeScript 5 · Tailwind CSS 4 · App Router |
| Backend | FastAPI · uvicorn · Python 3.10+ |
| Model | VibeVoice Realtime 0.5B via JezzWTF fork |
| Audio format | 24 kHz · float32 PCM · streamed as SSE · assembled to WAV in browser |
| State management | React `useReducer` in `page.tsx` — no Zustand, no Redux |
| Persistence | None — generated audio is an ephemeral browser Blob |
| Packages | pnpm workspace (frontend) · uv (Python) |

### Current generation flow

```
User submits script
  → POST /api/generate (Next.js proxy)
  → POST /generate (FastAPI)
  → VibeVoice inference thread
  → SSE stream of base64 float32 PCM chunks
  → Browser decodes chunks, adaptive buffering, live Web Audio playback
  → On complete: chunks merged, RIFF/WAV header prepended, Blob URL created
  → User can play back or download the WAV
```

### Key files

```
web/
  app/
    page.tsx                    main generation UI (AppState via useReducer)
    api/generate/route.ts       SSE proxy to FastAPI
    api/health/route.ts         health check proxy
  components/
    Header.tsx
    TextInputPanel.tsx
    AudioPlayer.tsx
    GenerationControls.tsx
    StatusLog.tsx
  hooks/
    useStreamingGeneration.ts   core streaming + WAV assembly
    useAudioPlayer.ts           HTML5 audio element wrapper

server/
  vibevoice_server.py           entire FastAPI app (972 lines)
  start.sh                      launcher (CPU/CUDA detection, uv sync, uvicorn)
  download_model.py             HuggingFace prefetch

docs/
  studio-build-plan.md          this file

roadmap.md                      high-level phase vision
DESIGN.md                       brand + design system (colours, type, spacing)
AGENTS.md                       AI agent / CI guide
```

---

## 3. Locked Technical Decisions

These decisions are final and must not be revisited without explicit agreement. New phases build on them.

### 3.1 Rendering approach — Hybrid DOM + Canvas 2D

The Studio uses a **hybrid rendering model**:

| Layer | Technology |
|---|---|
| App shell, layout, sidebars, panels, inspector | React + Tailwind CSS (DOM) |
| Track headers, controls, transport, modals | React + Tailwind CSS (DOM) |
| Timeline clip containers + positioning | React + CSS (`left`/`width` from time → pixels) |
| Waveform rendering inside clips | Raw Canvas 2D |
| Timeline ruler | Raw Canvas 2D |
| Playhead overlay | Raw Canvas 2D |
| Browser playback preview | Web Audio API |
| Final render + export | Python + FFmpeg (server-side only) |

**Why not full canvas:** Every non-waveform element — buttons, text, inputs, scroll, keyboard focus, accessibility — works better in DOM. Reimplementing all of that in canvas is wasted effort.

**Why not pure CSS:** Waveform peaks are thousands of pixel-height values per clip. DOM representation would be extremely slow. Canvas draws them in a tight loop in milliseconds.

**Why not WaveSurfer.js as the core:** WaveSurfer owns playback and its own event model. VibePod Studio needs its own clip model, its own timeline, and eventually its own multi-track playback. Adapting around WaveSurfer's assumptions creates friction. It may be used for standalone audio preview components (e.g., the generation page player), not the Studio timeline.

**Why not Konva.js:** Overkill for v1. Konva is designed for fully canvas-based scenes (whiteboards, diagrams). VibePod's timeline is mostly DOM. The additional mental model (Stage/Layer/Group/Transformer) is not justified unless interaction complexity grows significantly beyond v1.

### 3.2 Frontend stack — No additions without justification

Build inside the existing stack. New packages require a written reason in this document.

**Approved additions (to be installed when their phase begins):**

| Package | Purpose | Phase |
|---|---|---|
| `zustand` | Studio editor state | Phase 2 |
| `@dnd-kit/core` + `@dnd-kit/utilities` | Clip drag-and-drop in timeline | Phase 2 |
| `better-sqlite3` | SQLite for job and project persistence | Phase 1 |

**Conditionally approved (evaluate at phase start):**

| Package | Purpose | Condition |
|---|---|---|
| `framer-motion` | Clip move animations | Only if DnD-kit transitions feel rough after prototype |
| `@radix-ui/react-*` | Accessible modal/dropdown primitives | Only if building custom is taking too long |

### 3.3 Backend stack — Python + FFmpeg for all rendering

Browser-side audio mixing is only for **preview**. Export always goes to the Python backend.

**Approved backend additions:**

| Package | Purpose | Phase |
|---|---|---|
| `soundfile` | Already present — WAV read/write | Phase 1 |
| `numpy` | Audio array manipulation | Phase 1 |
| `pydub` | Audio trimming, mixing, concatenation | Phase 2 |
| `pyloudnorm` | Loudness normalisation (LUFS) | Phase 5 |

FFmpeg must be available on the server host. The render endpoint assumes `ffmpeg` is on PATH.

### 3.4 State management — Zustand for Studio, useReducer stays on generation page

The existing generation page uses `useReducer` and works well. Do not refactor it.

Studio requires a shared store that multiple components read and write (timeline, inspector, transport, script panel). Zustand is the right tool. It is lightweight, does not require providers, and handles editor-style state (undo stacks, selection, playhead) cleanly.

### 3.5 Database — SQLite from Phase 1

Do not start with flat JSON files. SQLite is still a single file, requires no server process, and gives proper queries, transactions, and schema migrations from day one. Use `better-sqlite3` in the Next.js API layer.

Schema lives in `web/lib/db/schema.sql`. Migrations are numbered SQL files in `web/lib/db/migrations/`.

### 3.6 Audio sample rate

All generated audio is 24 kHz float32 mono (VibeVoice output). Studio renders at 44.1 kHz stereo WAV or 48 kHz for podcast MP3 export. The render pipeline handles resampling.

---

## 4. Non-Goals

These will not be built and must not creep in:

- **Real-time collaborative editing** — single-user per project only
- **Cloud sync or user accounts** — local-first, no auth system
- **MIDI or music composition** — audio clips only, no MIDI tracks
- **Plugin system** — no third-party audio plugin API
- **Browser-side FFmpeg (ffmpeg.wasm)** — all rendering is server-side
- **Mobile / responsive Studio layout** — Studio targets desktop viewport only
- **Offline PWA** — the server must be running; no service worker caching of model output
- **Real-time voice cloning** — out of scope until VibeVoice supports it cleanly
- **Exporting to streaming platforms** — export to file only; no Spotify/Apple Podcasts upload

---

## 5. Data Models

### 5.1 Generation job

```ts
type GenerationJob = {
  id: string;                      // "gen_<nanoid>"
  createdAt: string;               // ISO 8601
  status: "pending" | "generating" | "complete" | "error" | "cancelled";
  script: string;
  speaker: string;
  cfgScale: number;
  inferenceSteps: number;
  durationSecs: number | null;     // set on complete
  sampleRate: number;              // always 24000
  audioPath: string | null;        // relative to data/generations/<id>/audio.wav
  waveformPath: string | null;     // relative to data/generations/<id>/waveform.json
  errorMessage: string | null;
};
```

### 5.2 Studio project

```ts
type StudioProject = {
  id: string;                      // "proj_<nanoid>"
  name: string;
  createdAt: string;
  updatedAt: string;
  script: ScriptDocument;
  assets: AudioAsset[];
  tracks: Track[];
  edits: EditOperation[];
  renderSettings: RenderSettings;
};
```

### 5.3 Script document

```ts
type ScriptDocument = {
  blocks: ScriptBlock[];
};

type ScriptBlock = {
  id: string;                      // "block_<nanoid>"
  speakerId: string;
  text: string;
  order: number;
  generatedAssetId: string | null;
  timelineClipIds: string[];
};
```

### 5.4 Audio asset

```ts
type AudioAsset = {
  id: string;                      // "asset_<nanoid>"
  projectId: string | null;        // null = generation library asset
  kind: "generated_voice" | "upload" | "music" | "sfx" | "render";
  filePath: string;
  durationSecs: number;
  sampleRate: number;
  channels: number;
  waveformPath: string | null;
  source: {
    generationJobId?: string;
    scriptBlockId?: string;
    providerId?: string;
    modelId?: string;
    voiceId?: string;
    settings?: Record<string, unknown>;
  } | null;
};
```

### 5.5 Track

```ts
type Track = {
  id: string;                      // "track_<nanoid>"
  name: string;
  type: "voice" | "music" | "sfx" | "ambience" | "master";
  order: number;
  muted: boolean;
  solo: boolean;
  gainDb: number;
  clips: TimelineClip[];
};
```

### 5.6 Timeline clip

```ts
type TimelineClip = {
  id: string;                      // "clip_<nanoid>"
  assetId: string;
  trackId: string;
  startTime: number;               // seconds from timeline origin
  sourceStart: number;             // trim start within source asset (seconds)
  sourceEnd: number;               // trim end within source asset (seconds)
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  linkedScriptRange: {
    blockId: string;
    startChar: number;
    endChar: number;
  } | null;
};
```

### 5.7 Edit operation (non-destructive EDL)

```ts
type EditOperation =
  | { type: "split";  clipId: string; at: number }
  | { type: "trim";   clipId: string; sourceStart: number; sourceEnd: number }
  | { type: "move";   clipId: string; startTime: number; trackId: string }
  | { type: "gain";   clipId: string; gainDb: number }
  | { type: "fade";   clipId: string; fadeInMs: number; fadeOutMs: number }
  | { type: "delete"; clipId: string }
  | { type: "mute";   trackId: string; muted: boolean }
  | { type: "solo";   trackId: string; solo: boolean };
```

### 5.8 Take (regeneration history)

```ts
type Take = {
  id: string;                      // "take_<nanoid>"
  scriptBlockId: string;
  assetId: string;
  voiceId: string;
  modelId: string;
  settings: Record<string, unknown>;
  createdAt: string;
  rating: number | null;           // 1-5 stars, optional
  notes: string | null;
  isActive: boolean;               // true = the one placed on the timeline
};
```

### 5.9 Render settings

```ts
type RenderSettings = {
  format: "wav" | "mp3";
  sampleRate: 44100 | 48000;
  bitrate: number | null;          // kbps, null for WAV
  normaliseLoudness: boolean;
  lufsTarget: number;              // default -16 LUFS for podcast
  metadata: {
    title: string;
    artist: string;
    album: string;
    episodeNumber: number | null;
    description: string;
  } | null;
};
```

### 5.10 Waveform peaks

```ts
type WaveformPeaks = {
  sampleRate: number;
  durationSecs: number;
  channels: number;
  samplesPerPixel: number;
  length: number;
  data: {
    min: number[];                 // range -1.0 to 0.0
    max: number[];                 // range 0.0 to 1.0
  };
};
```

---

## 6. Storage Layout

```
data/
  generations/
    gen_<id>/
      audio.wav                   raw float32 WAV at 24 kHz
      waveform.json               WaveformPeaks at 256 samples/pixel
      metadata.json               GenerationJob fields (denormalised)

  projects/
    proj_<id>/
      project.json                full StudioProject serialised
      assets/
        asset_<id>.wav            uploaded or imported audio
      renders/
        render_<timestamp>.wav    exported renders
        render_<timestamp>.mp3

  db/
    vibepod.db                    SQLite database
```

The SQLite database is the source of truth for IDs, status, and relationships. JSON files are the source of truth for audio and waveform data.

---

## 7. API Contract

All new routes are under `/api/`. The Next.js app proxies to FastAPI only for generation and health. Persistence routes are handled directly by Next.js API routes talking to SQLite.

### 7.1 Generation (existing, extended)

```
POST   /api/generate                   start streaming generation (existing)
GET    /api/health                     server health check (existing)
```

### 7.2 Generation library (Phase 1)

```
GET    /api/generations                list all jobs, newest first
                                       query: ?limit=20&offset=0&status=complete
GET    /api/generations/:id            get single job metadata
GET    /api/generations/:id/audio      stream WAV file
GET    /api/generations/:id/waveform   get WaveformPeaks JSON
DELETE /api/generations/:id            delete job and files
```

### 7.3 Projects (Phase 2)

```
POST   /api/projects                   create project
GET    /api/projects                   list projects
GET    /api/projects/:id               get project with full StudioProject
PUT    /api/projects/:id               save/autosave project
DELETE /api/projects/:id               delete project and assets
```

### 7.4 Project assets (Phase 2)

```
POST   /api/projects/:id/assets        upload audio file or import from generation
GET    /api/projects/:id/assets/:aid   get asset metadata
DELETE /api/projects/:id/assets/:aid   remove asset
```

### 7.5 Takes (Phase 3)

```
GET    /api/projects/:id/takes/:blockId         list takes for a script block
POST   /api/projects/:id/takes/:blockId         save new take
PUT    /api/projects/:id/takes/:blockId/:takeId  set active take
DELETE /api/projects/:id/takes/:blockId/:takeId  delete take
```

### 7.6 Render (Phase 5)

```
POST   /api/projects/:id/render        start render job (sends EDL to Python)
GET    /api/projects/:id/renders       list render history
GET    /api/projects/:id/renders/:rid  poll render status
GET    /api/projects/:id/renders/:rid/download  stream rendered file
```

All error responses follow:

```json
{ "error": "human-readable message", "code": "SNAKE_CASE_CODE" }
```

---

## 8. Frontend Routes

```
/                                  generation page (current fast path, unchanged)
/library                           generation library — browse and replay saved jobs
/projects                          project dashboard — create or open Studio projects
/studio/:projectId                 Studio workspace
/studio/new                        redirect: creates project + navigates to /studio/:id
```

---

## 9. Component Hierarchy

### Generation page (existing — do not restructure without reason)

```
page.tsx
  Header
  TextInputPanel
  GenerationControls
  StatusLog
  AudioPlayer
```

### Library page (Phase 1)

```
/app/library/page.tsx
  Header
  LibraryPage
    GenerationCard[]
      WaveformPreview          (small static canvas render of peaks)
      GenerationMetadata       (speaker, duration, date, settings)
      GenerationActions        (play, download, open in studio, delete)
```

### Projects dashboard (Phase 2)

```
/app/projects/page.tsx
  Header
  ProjectsPage
    NewProjectButton
    ProjectCard[]
      ProjectThumbnail
      ProjectMetadata
      ProjectActions
```

### Studio workspace (Phase 2+)

```
/app/studio/[projectId]/page.tsx
  StudioShell
    StudioTopBar
      ProjectNameInput
      UndoButton / RedoButton
      SaveStatus
      ExportButton
    StudioBody
      ProjectSidebar
        SidebarTabs (Script | Voices | Media | Effects | Templates)
        ScriptPanel           (Phase 3)
        VoicesPanel
        MediaBin              (Phase 2)
        EffectsPanel          (Phase 4)
      StudioMain
        TimelineRuler         (canvas)
        TimelineArea
          TimelineTrack[]     (one per track)
            TrackHeader
            TrackClipArea
              TimelineClip[]
                WaveformCanvas  (canvas)
                ClipLabel
      InspectorPanel
        ClipInspector         (when clip selected)
          ClipMetadata
          GainControl
          FadeControls
          RegenerateButton    (Phase 3)
          TakeStack           (Phase 3)
        TrackInspector        (when track selected)
        EmptyInspector        (nothing selected)
    TransportBar
      PlayPauseButton
      StopButton
      PlayheadTimeDisplay
      ZoomControls
      SnapToggle
```

---

## 10. Timeline Rendering Model

### Clip positioning

Timeline clips are DOM elements with CSS `position: absolute`. Position and size derive from the project's pixels-per-second zoom level:

```ts
const left = clip.startTime * pixelsPerSecond;
const width = (clip.sourceEnd - clip.sourceStart) * pixelsPerSecond;
```

The `pixelsPerSecond` value lives in Zustand and changes with zoom. All clip positions recompute via derived selectors.

### Waveform canvas

Each `TimelineClip` contains a `<canvas>` element that receives peak data as a prop. The renderer draws one vertical line per pixel column:

```ts
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: WaveformPeaks,
  width: number,
  height: number,
  color: string
): void {
  const midY = height / 2;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x++) {
    const peakIndex = Math.floor((x / width) * peaks.length);
    const minY = midY + peaks.data.min[peakIndex] * midY;
    const maxY = midY - peaks.data.max[peakIndex] * midY;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, minY);
    ctx.lineTo(x + 0.5, maxY);
    ctx.stroke();
  }
}
```

The canvas rerenders when `width`, `peaks`, or zoom changes. It does not rerender on playback.

### Playhead

The playhead is a separate absolutely-positioned element (thin vertical line) that overlays the entire timeline area. Its `left` position is updated via `requestAnimationFrame` during playback — no React state updates, direct DOM style write.

### Timeline ruler

A `<canvas>` element spanning the full timeline width. Draws time markers at intervals derived from current zoom level. Rerenders on zoom change only.

---

## 11. Playback Model

Studio preview uses the **Web Audio API**, not HTML5 `<audio>`.

### Graph

```
AudioBufferSourceNode (per clip)
  → GainNode (clip gain + fades)
    → GainNode (track gain)
      → GainNode (master gain)
        → AudioContext.destination
```

### Scheduling

On play, the engine:

1. Reads current `playheadTime` from Zustand.
2. For each clip where `clip.startTime + (clip.sourceEnd - clip.sourceStart) > playheadTime`:
   - Calculates `offset = playheadTime - clip.startTime + clip.sourceStart` (clamped to 0)
   - Calls `source.start(audioCtx.currentTime, offset)`
3. All sources start in sync via a shared `startTime = audioCtx.currentTime + 0.01` anchor.

On stop or seek, all sources are disconnected and the graph is torn down. A new graph is built on the next play call.

### Audio buffer cache

Fetched WAV files are decoded to `AudioBuffer` via `AudioContext.decodeAudioData()` and cached by asset ID. Cache is invalidated if the asset is deleted or replaced.

### Fade implementation

Fades are implemented as `AudioParam` ramps on the clip GainNode:

```ts
gainNode.gain.setValueAtTime(0, startTime);
gainNode.gain.linearRampToValueAtTime(clipGain, startTime + fadeInSecs);
gainNode.gain.setValueAtTime(clipGain, endTime - fadeOutSecs);
gainNode.gain.linearRampToValueAtTime(0, endTime);
```

---

## 12. Export Rendering Model

When the user triggers export, the frontend sends a render request to the Python backend. The browser is never involved in mixing.

### Request payload

```ts
type RenderRequest = {
  projectId: string;
  tracks: Track[];
  clips: TimelineClip[];
  assets: Array<{ id: string; filePath: string }>;
  settings: RenderSettings;
};
```

### Python render pipeline

```python
# Pseudocode — actual implementation lives in server/render.py
def render_project(req: RenderRequest) -> str:
    # 1. Load all source audio files into numpy arrays
    # 2. Determine total timeline duration
    # 3. Create output buffer (zeros) at target sample rate
    # 4. For each clip (sorted by startTime):
    #    a. Load source audio
    #    b. Resample to target sample rate if needed
    #    c. Apply trim (sourceStart → sourceEnd)
    #    d. Apply gain (dB → linear)
    #    e. Apply fade in/out (linear ramp)
    #    f. Place at clip.startTime offset in output buffer
    # 5. Apply track gain to each track's summed signal
    # 6. Sum all tracks into master buffer
    # 7. Apply master gain
    # 8. If normaliseLoudness: apply pyloudnorm to target LUFS
    # 9. Export WAV or MP3 via soundfile / ffmpeg
    # 10. Write to data/projects/<id>/renders/<timestamp>.wav
    # 11. Return file path
```

Render runs in a background thread. The client polls `GET /api/projects/:id/renders/:rid` for status.

---

## 13. Phase Breakdown

### Phase 0 — Stabilise (current state → pre-Phase 1)

**Goal:** Clean foundation. No new features.

Tasks:
- [ ] Extract WAV assembly from `useStreamingGeneration.ts` into `web/lib/audio/wav.ts`
- [ ] Extract waveform peak generation into `server/waveform.py`
- [ ] Confirm generation cancellation works cleanly (stream abort + server cancel_event)
- [ ] Add `nanoid` to backend for stable generation IDs
- [ ] Add `data/` directory to `.gitignore`

**Acceptance:** WAV assembly is a pure function with unit tests. Generation IDs are stable.

---

### Phase 1 — Persistent Generation Library

**Goal:** Every generation is saved. Users can browse, play, and download past generations.

**Backend tasks:**
- [ ] Add SQLite setup (`data/db/vibepod.db`, schema migration 001)
- [ ] `generations` table: `id, created_at, status, script, speaker, cfg_scale, inference_steps, duration_secs, sample_rate, audio_path, waveform_path, error_message`
- [ ] On generation complete: save WAV to `data/generations/<id>/audio.wav`
- [ ] On generation complete: compute and save waveform peaks to `data/generations/<id>/waveform.json`
- [ ] Implement `GET /api/generations` (list, paginated)
- [ ] Implement `GET /api/generations/:id` (single)
- [ ] Implement `GET /api/generations/:id/audio` (stream file)
- [ ] Implement `GET /api/generations/:id/waveform` (peaks JSON)
- [ ] Implement `DELETE /api/generations/:id` (delete row + files)

**Frontend tasks:**
- [ ] Install `better-sqlite3` + types
- [ ] Create `web/lib/db/` — schema, migration runner, query helpers
- [ ] Create `/library` route and `LibraryPage` component
- [ ] `GenerationCard` component: waveform preview canvas, metadata, play/download/delete actions
- [ ] `WaveformPreview` component: draws peaks on canvas (static, no playback)
- [ ] Mini audio player for library card playback (reuse `useAudioPlayer` hook)
- [ ] Link "Open in Studio" button (navigates to `/studio/new?fromGeneration=<id>`)
- [ ] Add "Library" link to `Header`

**Acceptance:**
- Generate audio → close browser → reopen → generation appears in library with waveform
- Play button plays correct audio
- Delete removes from library and disk
- Library renders without error when empty

---

### Phase 2 — Studio MVP

**Goal:** Single-track timeline editor. Open a generation, view waveform, trim/split/delete, export WAV.

**Backend tasks:**
- [ ] `projects` table: `id, name, created_at, updated_at, project_json`
- [ ] `assets` table: `id, project_id, kind, file_path, duration_secs, sample_rate, channels, waveform_path, source_json`
- [ ] Implement `POST /api/projects`
- [ ] Implement `GET /api/projects` (list)
- [ ] Implement `GET /api/projects/:id`
- [ ] Implement `PUT /api/projects/:id` (save)
- [ ] Implement `DELETE /api/projects/:id`
- [ ] Implement `POST /api/projects/:id/assets` (import from generation or upload)
- [ ] Implement basic render endpoint (single voice track, WAV out only)

**Frontend tasks:**
- [ ] Install `zustand`, `@dnd-kit/core`, `@dnd-kit/utilities`
- [ ] Create Studio Zustand store (`web/stores/studioStore.ts`)
  - Project state, selected clip, playhead time, zoom, isPlaying, undo stack
  - Actions: selectClip, moveClip, splitClip, trimClip, setClipGain, undo, redo
- [ ] Create `/projects` route and dashboard
- [ ] Create `/studio/[projectId]` route
- [ ] `StudioShell` — top-level layout
- [ ] `StudioTopBar` — project name, undo/redo, save status, export button
- [ ] `ProjectSidebar` — tabs shell + `MediaBin` tab
- [ ] `MediaBin` — list assets, drag to timeline
- [ ] `TimelineArea` — scrollable container with tracks
- [ ] `TimelineRuler` — canvas ruler, rerenders on zoom
- [ ] `TimelineTrack` — track header + clip area
- [ ] `TimelineClip` — positioned div, selectable, draggable
- [ ] `WaveformCanvas` — canvas inside clip, draws peaks
- [ ] `InspectorPanel` — shows selected clip properties
- [ ] `TransportBar` — play/pause/stop, time display, zoom slider
- [ ] Web Audio playback engine (`web/lib/audio/playbackEngine.ts`)
- [ ] Autosave: debounced PUT on every store change (500ms delay)
- [ ] Export dialog: format picker → POST /api/projects/:id/render → poll → download

**Acceptance:**
- Open generation from library → Studio loads with waveform on single track
- Play button plays audio in sync with playhead
- Drag clip moves it on timeline
- Split at playhead creates two clips
- Trim handles reduce clip duration
- Delete removes clip
- Export produces downloadable WAV
- Undo/redo works for all operations

---

### Phase 3 — Script-Linked Regeneration

**Goal:** Script blocks are the source of truth. Clicking a clip highlights the script. Regenerating a clip produces a new take.

**Backend tasks:**
- [ ] `takes` table: `id, project_id, script_block_id, asset_id, voice_id, model_id, settings_json, created_at, rating, notes, is_active`
- [ ] Implement takes API endpoints (list, create, set active, delete)
- [ ] Waveform peak generation on regenerated takes

**Frontend tasks:**
- [ ] `ScriptPanel` sidebar tab — editable script blocks with speaker labels
- [ ] Script block → clip bidirectional linking (click clip → highlight block, click block → select clip)
- [ ] Clip inspector: show source script text (read-only in Phase 3)
- [ ] `RegenerateButton` in inspector — sends block text + current voice settings → new generation
- [ ] Regeneration creates new Take, new Asset, new Clip (does not replace existing clip automatically)
- [ ] `TakeStack` in inspector — list takes for selected block, click to preview, "Replace in timeline" action
- [ ] Per-block voice setting override (speaker, cfg_scale, inference_steps)

**Acceptance:**
- Clicking a clip selects the related script block in ScriptPanel
- Clicking a script block selects the clip on the timeline
- Regenerate produces a new take visible in TakeStack
- "Replace in timeline" swaps the clip's asset to the new take
- Previous take is preserved and can be restored
- Undo works across take replacements

---

### Phase 4 — Multi-Speaker Podcast Builder

**Goal:** Multiple voice tracks, music/SFX tracks, speaker assignment, show templates.

**Tasks:**
- [ ] Multiple tracks: Host, Guest, Music, SFX, Ambience
- [ ] Track type icons and colour coding per track type
- [ ] Per-track mute/solo buttons (functional in Web Audio engine)
- [ ] Track gain slider
- [ ] Speaker assignment per track (voice preset tied to track)
- [ ] Music/SFX uploads to media bin
- [ ] Basic music ducking on voice tracks (auto-gain on music track when voice plays)
- [ ] Show template: save a project's track layout + speaker assignments as a reusable template
- [ ] Template picker on new project creation

**Acceptance:**
- Two voice tracks play independently and mix correctly
- Mute/solo work
- Music bed plays under voice tracks
- Saving as template creates a new project correctly
- Exported WAV contains all tracks mixed

---

### Phase 5 — Production Export

**Goal:** MP3 export, loudness normalisation, podcast metadata, render queue, mastering presets.

**Tasks:**
- [ ] MP3 export via FFmpeg on render backend
- [ ] `pyloudnorm` integration — LUFS targeting per preset
- [ ] Export presets: Podcast Balanced, Podcast Loud, Audiobook, Raw WAV, YouTube Audio
- [ ] ID3 metadata fields in export dialog (title, artist, episode number, cover art, description)
- [ ] Render job queue — multiple renders can be queued
- [ ] Render status polling with progress bar
- [ ] Render history panel in project
- [ ] Autosave recovery: on crash/close, restore last autosaved state on next open

**Acceptance:**
- MP3 export produces valid file with correct ID3 tags
- Loudness normalisation hits target LUFS ± 0.5
- Render queue processes jobs sequentially
- Recovering an autosave restores timeline to last saved state

---

## 14. Acceptance Criteria

### Cross-cutting criteria (all phases)

- No TypeScript `any` types anywhere in Studio code
- Zustand store actions are pure (no side effects except explicit async actions)
- Autosave never blocks the UI thread
- Undo/redo covers every timeline mutation
- No orphaned audio files — deleting a project deletes its files
- Waveform canvas does not rerender on playback (only on zoom/resize)
- Playhead position updates at 60fps via `requestAnimationFrame`, not React state

---

## 15. Deferred Decisions

These are intentionally not decided yet. Revisit at the phase that needs them.

| Decision | Deferred until |
|---|---|
| Voice cloning / custom voice upload | Depends on VibeVoice roadmap |
| XTTS or ElevenLabs as second provider | Phase 3+ — only after VoiceModelProvider abstraction is proven |
| Clip crossfades (overlapping clips) | Phase 4 — requires mixing model update |
| Clip-level EQ / compression | Phase 5 |
| Per-segment emotion / style tags | Phase 3 evaluation |
| WebSocket vs SSE for render progress | Phase 5 — evaluate based on render durations seen in practice |
| IndexedDB caching of AudioBuffers | Phase 2 evaluation — only if cache miss latency is a real problem |
| Noise gate / background removal | Post-Phase 5 |
| Multi-window Studio (popout inspector etc.) | Not planned |

---

## 16. Third-Party Library Policy

VibePod is an open-source project. Any third-party library integrated into the codebase must satisfy:

1. **License:** MIT, Apache 2.0, BSD 2/3-Clause, or ISC. No GPL unless the entire application is separately GPL-licensed. No CC-NC.
2. **Attribution:** Add to a `LICENSES.md` file in the repo root when integrating. Include library name, version, license type, and project URL.
3. **Size:** For frontend packages, run `bundlephobia` before adding. Prefer packages under 20 kB gzipped unless there is no alternative.
4. **Maintenance:** Prefer packages with active maintenance. Check last commit date and open issue count before adding.
5. **Source code:** If copying or adapting a snippet (not a full package), add an inline comment with the source URL and license.

---

*This document is the execution specification. The high-level vision lives in `roadmap.md`. When in doubt about scope, refer to Section 4 (Non-Goals) first.*
