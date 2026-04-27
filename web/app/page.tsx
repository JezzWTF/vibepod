"use client";

import { useReducer, useCallback, useEffect } from "react";
import Header from "@/components/Header";
import TextInputPanel from "@/components/TextInputPanel";
import GenerationControls from "@/components/GenerationControls";
import AudioPlayer from "@/components/AudioPlayer";
import StatusLog from "@/components/StatusLog";
import { useStreamingGeneration } from "@/hooks/useStreamingGeneration";

export type ServerStatus = "offline" | "downloading" | "loading" | "online" | "error";

export interface DownloadProgress {
  done: number;
  total: number;
}

interface AppState {
  script: string;
  speaker: string;
  cfgScale: number;
  inferenceSteps: number;
  isGenerating: boolean;
  genElapsed: number;
  genPct: number | null;
  audioUrl: string | null;
  logs: string[];
  serverStatus: ServerStatus;
  downloadProgress: DownloadProgress | null;
  availableVoices: string[];
}

type AppAction =
  | { type: "SET_SCRIPT"; payload: string }
  | { type: "SET_SPEAKER"; payload: string }
  | { type: "SET_CFG_SCALE"; payload: number }
  | { type: "SET_INFERENCE_STEPS"; payload: number }
  | { type: "START_GENERATION" }
  | { type: "GEN_PROGRESS"; elapsed: number; pct: number | null }
  | { type: "GENERATION_SUCCESS"; payload: string }
  | { type: "GENERATION_CANCELLED" }
  | { type: "GENERATION_ERROR" }
  | { type: "ADD_LOG"; payload: string }
  | {
      type: "SET_SERVER_STATUS";
      payload: { status: ServerStatus; progress?: DownloadProgress | null; voices?: string[] };
    };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SCRIPT":         return { ...state, script: action.payload };
    case "SET_SPEAKER":        return { ...state, speaker: action.payload };
    case "SET_CFG_SCALE":      return { ...state, cfgScale: action.payload };
    case "SET_INFERENCE_STEPS": return { ...state, inferenceSteps: action.payload };
    case "START_GENERATION":
      return { ...state, isGenerating: true, audioUrl: null, logs: [], genElapsed: 0, genPct: null };
    case "GEN_PROGRESS":
      return { ...state, genElapsed: action.elapsed, genPct: action.pct };
    case "GENERATION_SUCCESS":
      return { ...state, isGenerating: false, genElapsed: 0, genPct: null, audioUrl: action.payload };
    case "GENERATION_CANCELLED":
    case "GENERATION_ERROR":
      return { ...state, isGenerating: false, genElapsed: 0, genPct: null };
    case "ADD_LOG":
      return { ...state, logs: [...state.logs, action.payload] };
    case "SET_SERVER_STATUS":
      return {
        ...state,
        serverStatus: action.payload.status,
        downloadProgress: action.payload.progress ?? null,
        availableVoices:
          action.payload.voices?.length ? action.payload.voices : state.availableVoices,
      };
    default: return state;
  }
}

const initialState: AppState = {
  script: "",
  speaker: "carter",
  cfgScale: 1.5,
  inferenceSteps: 10,
  isGenerating: false,
  genElapsed: 0,
  genPct: null,
  audioUrl: null,
  logs: [],
  serverStatus: "offline",
  downloadProgress: null,
  availableVoices: [],
};

export default function HomePage() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const wordCount = state.script.trim() === "" ? 0 : state.script.trim().split(/\s+/).length;

  const addLog = useCallback((msg: string) => dispatch({ type: "ADD_LOG", payload: msg }), []);
  const handleGenerationStart = useCallback(() => dispatch({ type: "START_GENERATION" }), []);
  const handleGenerationProgress = useCallback((elapsed: number, pct: number | null) => {
    dispatch({ type: "GEN_PROGRESS", elapsed, pct });
  }, []);
  const handleGenerationSuccess = useCallback((audioUrl: string) => {
    dispatch({ type: "GENERATION_SUCCESS", payload: audioUrl });
  }, []);
  const handleGenerationCancel = useCallback(() => dispatch({ type: "GENERATION_CANCELLED" }), []);
  const handleGenerationError = useCallback(() => dispatch({ type: "GENERATION_ERROR" }), []);

  const {
    generate,
    pauseStream,
    resumeStream,
    stop,
    isStreamPaused,
  } = useStreamingGeneration({
    onLog: addLog,
    onStart: handleGenerationStart,
    onProgress: handleGenerationProgress,
    onSuccess: handleGenerationSuccess,
    onCancel: handleGenerationCancel,
    onError: handleGenerationError,
  });

  // Server health polling — fast while not ready, slow when online
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      let nextStatus: ServerStatus = "offline";
      let nextProgress: DownloadProgress | null = null;
      let nextVoices: string[] = [];
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = await res.json() as {
          status: ServerStatus;
          progress?: DownloadProgress | null;
          voices?: string[];
        };
        nextStatus = data.status ?? "offline";
        nextProgress = data.progress ?? null;
        nextVoices = data.voices ?? [];
      } catch {
        nextStatus = "offline";
      }
      if (!cancelled) {
        dispatch({ type: "SET_SERVER_STATUS", payload: { status: nextStatus, progress: nextProgress, voices: nextVoices } });
        timeoutId = setTimeout(poll, nextStatus === "online" ? 15_000 : 2_000);
      }
    }

    poll();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!state.script.trim() || state.isGenerating) return;
    addLog(`${wordCount} words queued`);
    await generate({
      text: state.script,
      speaker: state.speaker,
      cfgScale: state.cfgScale,
      inferenceSteps: state.inferenceSteps,
    });
  }, [
    addLog,
    generate,
    state.cfgScale,
    state.inferenceSteps,
    state.isGenerating,
    state.script,
    state.speaker,
    wordCount,
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left: script + audio player */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <TextInputPanel
              value={state.script}
              onChange={(text) => dispatch({ type: "SET_SCRIPT", payload: text })}
            />
            {state.audioUrl && <AudioPlayer audioUrl={state.audioUrl} />}
          </div>

          {/* Right: controls + log */}
          <div className="flex flex-col gap-6">
            <GenerationControls
              speaker={state.speaker}
              availableVoices={state.availableVoices}
              onSpeakerChange={(v) => dispatch({ type: "SET_SPEAKER", payload: v })}
              cfgScale={state.cfgScale}
              onCfgScaleChange={(v) => dispatch({ type: "SET_CFG_SCALE", payload: v })}
              inferenceSteps={state.inferenceSteps}
              onInferenceStepsChange={(v) => dispatch({ type: "SET_INFERENCE_STEPS", payload: v })}
              onGenerate={handleGenerate}
              onStop={stop}
              onPauseStream={pauseStream}
              onResumeStream={resumeStream}
              isStreamPaused={isStreamPaused}
              isGenerating={state.isGenerating}
              genElapsed={state.genElapsed}
              genPct={state.genPct}
              wordCount={wordCount}
              serverStatus={state.serverStatus}
              downloadProgress={state.downloadProgress}
            />
            <StatusLog messages={state.logs} />
          </div>

        </div>
      </main>
    </div>
  );
}
