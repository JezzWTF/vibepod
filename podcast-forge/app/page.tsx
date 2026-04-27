"use client";

import { useReducer, useCallback } from "react";
import Header from "@/components/Header";
import TextInputPanel from "@/components/TextInputPanel";
import GenerationControls from "@/components/GenerationControls";
import AudioPlayer from "@/components/AudioPlayer";
import StatusLog from "@/components/StatusLog";

interface AppState {
  script: string;
  cfgScale: number;
  inferenceSteps: number;
  isGenerating: boolean;
  audioUrl: string | null;
  logs: string[];
}

type AppAction =
  | { type: "SET_SCRIPT"; payload: string }
  | { type: "SET_CFG_SCALE"; payload: number }
  | { type: "SET_INFERENCE_STEPS"; payload: number }
  | { type: "START_GENERATION" }
  | { type: "GENERATION_SUCCESS"; payload: string }
  | { type: "GENERATION_ERROR"; payload: string }
  | { type: "ADD_LOG"; payload: string };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_SCRIPT":
      return { ...state, script: action.payload };
    case "SET_CFG_SCALE":
      return { ...state, cfgScale: action.payload };
    case "SET_INFERENCE_STEPS":
      return { ...state, inferenceSteps: action.payload };
    case "START_GENERATION":
      return {
        ...state,
        isGenerating: true,
        audioUrl: null,
        logs: [],
      };
    case "GENERATION_SUCCESS":
      return {
        ...state,
        isGenerating: false,
        audioUrl: action.payload,
      };
    case "GENERATION_ERROR":
      return {
        ...state,
        isGenerating: false,
      };
    case "ADD_LOG":
      return { ...state, logs: [...state.logs, action.payload] };
    default:
      return state;
  }
}

const initialState: AppState = {
  script: "",
  cfgScale: 2.5,
  inferenceSteps: 20,
  isGenerating: false,
  audioUrl: null,
  logs: [],
};

export default function HomePage() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const wordCount =
    state.script.trim() === ""
      ? 0
      : state.script.trim().split(/\s+/).length;

  const addLog = useCallback((msg: string) => {
    dispatch({ type: "ADD_LOG", payload: msg });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!state.script.trim() || state.isGenerating) return;

    dispatch({ type: "START_GENERATION" });
    addLog("Connecting to VibeVoice server...");

    try {
      addLog(`Sending script (${wordCount} words) for synthesis...`);
      addLog(
        `Settings: CFG=${state.cfgScale.toFixed(1)}, Steps=${state.inferenceSteps}`
      );

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: state.script,
          cfg_scale: state.cfgScale,
          inference_steps: state.inferenceSteps,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      addLog("Generating audio...");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      addLog(`Audio received — ${sizeMB} MB`);
      addLog("Done — audio ready for playback.");

      dispatch({ type: "GENERATION_SUCCESS", payload: url });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error occurred";
      addLog(`Error: ${message}`);
      dispatch({ type: "GENERATION_ERROR", payload: message });
    }
  }, [state.script, state.cfgScale, state.inferenceSteps, state.isGenerating, wordCount, addLog]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--background)" }}
    >
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: script input */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <TextInputPanel
              value={state.script}
              onChange={(text) =>
                dispatch({ type: "SET_SCRIPT", payload: text })
              }
            />
            {state.audioUrl && <AudioPlayer audioUrl={state.audioUrl} />}
          </div>

          {/* Right column: controls + log */}
          <div className="flex flex-col gap-6">
            <GenerationControls
              cfgScale={state.cfgScale}
              onCfgScaleChange={(v) =>
                dispatch({ type: "SET_CFG_SCALE", payload: v })
              }
              inferenceSteps={state.inferenceSteps}
              onInferenceStepsChange={(v) =>
                dispatch({ type: "SET_INFERENCE_STEPS", payload: v })
              }
              onGenerate={handleGenerate}
              isGenerating={state.isGenerating}
              wordCount={wordCount}
            />
            <StatusLog messages={state.logs} />
          </div>
        </div>
      </main>
    </div>
  );
}
