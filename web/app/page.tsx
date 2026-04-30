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

export interface ServerConfig {
  device: string;
  chunk_accum: number;
  prebuffer_secs: number;
  rebuffer_threshold_secs: number;
  resume_threshold_secs: number;
  default_inference_steps: number;
}

interface AppState {
  script: string;
  speaker: string;
  cfgScale: number;
  inferenceSteps: number;
  prebufferSecs: number;
  rebufferThresholdSecs: number;
  resumeThresholdSecs: number;
  isGenerating: boolean;
  genElapsed: number;
  genPct: number | null;
  audioUrl: string | null;
  logs: string[];
  serverStatus: ServerStatus;
  downloadProgress: DownloadProgress | null;
  availableVoices: string[];
  serverConfig: ServerConfig | null;
}

type AppAction =
  | { type: "SET_SCRIPT"; payload: string }
  | { type: "SET_SPEAKER"; payload: string }
  | { type: "SET_CFG_SCALE"; payload: number }
  | { type: "SET_INFERENCE_STEPS"; payload: number }
  | { type: "SET_PREBUFFER_SECS"; payload: number }
  | { type: "SET_REBUFFER_THRESHOLD"; payload: number }
  | { type: "SET_RESUME_THRESHOLD"; payload: number }
  | { type: "START_GENERATION" }
  | { type: "GEN_PROGRESS"; elapsed: number; pct: number | null }
  | { type: "GENERATION_SUCCESS"; payload: string }
  | { type: "GENERATION_CANCELLED" }
  | { type: "GENERATION_ERROR" }
  | { type: "ADD_LOG"; payload: string }
  | {
      type: "SET_SERVER_STATUS";
      payload: {
        status: ServerStatus;
        progress?: DownloadProgress | null;
        voices?: string[];
        config?: ServerConfig | null;
      };
    };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SCRIPT":         return { ...state, script: action.payload };
    case "SET_SPEAKER":        return { ...state, speaker: action.payload };
    case "SET_CFG_SCALE":      return { ...state, cfgScale: action.payload };
    case "SET_INFERENCE_STEPS": return { ...state, inferenceSteps: action.payload };
    case "SET_PREBUFFER_SECS": return { ...state, prebufferSecs: action.payload };
    case "SET_REBUFFER_THRESHOLD": return { ...state, rebufferThresholdSecs: action.payload };
    case "SET_RESUME_THRESHOLD": return { ...state, resumeThresholdSecs: action.payload };
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
    case "SET_SERVER_STATUS": {
      const isNewConfig = !state.serverConfig && action.payload.config;
      const deviceChanged = !!(state.serverConfig && action.payload.config && state.serverConfig.device !== action.payload.config.device);

      const nextSteps = (isNewConfig || deviceChanged)
          ? action.payload.config!.default_inference_steps
          : state.inferenceSteps;

      const nextPrebuffer = (isNewConfig || deviceChanged)
          ? action.payload.config!.prebuffer_secs
          : state.prebufferSecs;

      const nextRebuffer = (isNewConfig || deviceChanged)
          ? action.payload.config!.rebuffer_threshold_secs
          : state.rebufferThresholdSecs;

      const nextResume = (isNewConfig || deviceChanged)
          ? action.payload.config!.resume_threshold_secs
          : state.resumeThresholdSecs;

      return {
        ...state,
        serverStatus: action.payload.status,
        downloadProgress: action.payload.progress ?? null,
        availableVoices: action.payload.voices?.length
          ? action.payload.voices
          : state.availableVoices,
        serverConfig: action.payload.config ?? state.serverConfig,
        inferenceSteps: nextSteps,
        prebufferSecs: nextPrebuffer,
        rebufferThresholdSecs: nextRebuffer,
        resumeThresholdSecs: nextResume,
      };
    }
    default: return state;
  }
}

const initialState: AppState = {
  script: "",
  speaker: "carter",
  cfgScale: 1.5,
  inferenceSteps: 10,
  prebufferSecs: 5.0,
  rebufferThresholdSecs: 1.0,
  resumeThresholdSecs: 3.0,
  isGenerating: false,
  genElapsed: 0,
  genPct: null,
  audioUrl: null,
  logs: [],
  serverStatus: "offline",
  downloadProgress: null,
  availableVoices: [],
  serverConfig: null,
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

  const { generate, pauseStream, resumeStream, stop, isStreamPaused } = useStreamingGeneration({
    onLog: addLog,
    onStart: handleGenerationStart,
    onProgress: handleGenerationProgress,
    onSuccess: handleGenerationSuccess,
    onCancel: handleGenerationCancel,
    onError: handleGenerationError,
    prebufferSecs: state.prebufferSecs,
    rebufferThresholdSecs: state.rebufferThresholdSecs,
    resumeThresholdSecs: state.resumeThresholdSecs,
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
      let nextConfig: ServerConfig | null = null;
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as {
          status: ServerStatus;
          progress?: DownloadProgress | null;
          voices?: string[];
          config?: ServerConfig;
        };
        nextStatus = data.status ?? "offline";
        nextProgress = data.progress ?? null;
        nextVoices = data.voices ?? [];
        nextConfig = data.config ?? null;
      } catch {
        nextStatus = "offline";
      }
      if (!cancelled) {
        dispatch({
          type: "SET_SERVER_STATUS",
          payload: {
            status: nextStatus,
            progress: nextProgress,
            voices: nextVoices,
            config: nextConfig,
          },
        });
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
            prebufferSecs={state.prebufferSecs}
            onPrebufferSecsChange={(v) => dispatch({ type: "SET_PREBUFFER_SECS", payload: v })}
            rebufferThresholdSecs={state.rebufferThresholdSecs}
            onRebufferThresholdChange={(v) => dispatch({ type: "SET_REBUFFER_THRESHOLD", payload: v })}
            resumeThresholdSecs={state.resumeThresholdSecs}
            onResumeThresholdChange={(v) => dispatch({ type: "SET_RESUME_THRESHOLD", payload: v })}
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
