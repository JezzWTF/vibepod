"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { GenerationStatus, WaveformPeaks } from "@/lib/types/generation";

const threads = [
  { color: [174, 213, 191], amplitude: 25, period: 1.18, speed: 0.31, phase: 0.2 },
  { color: [139, 166, 182], amplitude: 31, period: 1.43, speed: -0.24, phase: 2 },
  { color: [194, 190, 166], amplitude: 20, period: 0.91, speed: 0.27, phase: 4.1 },
  { color: [161, 183, 171], amplitude: 28, period: 1.67, speed: -0.19, phase: 5.6 },
];
const bins = 240;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

function waveformBins(data: WaveformPeaks) {
  if (
    !data.length ||
    data.data?.min.length !== data.length ||
    data.data?.max.length !== data.length
  ) {
    throw new Error("Invalid waveform");
  }
  if (![...data.data.min, ...data.data.max].every(Number.isFinite))
    throw new Error("Invalid waveform");
  return Array.from({ length: bins }, (_, j) => {
    const from = Math.floor((j * data.length) / bins);
    const to = Math.max(from + 1, Math.floor(((j + 1) * data.length) / bins));
    return {
      min: Math.min(...data.data.min.slice(from, to)),
      max: Math.max(...data.data.max.slice(from, to)),
    };
  });
}

/** Motion conveys active synthesis only. Completion uses this take's actual peak data. */
function TakeSignal({ id, status }: { id: string; status: GenerationStatus }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<ReturnType<typeof waveformBins> | null>(null);
  const [error, setError] = useState(false);
  const motion = useRef({
    time: 0,
    generated: false,
    finishing: false,
    finishTime: 0,
    finished: false,
  });

  useEffect(() => {
    if (status !== "complete") return;
    const controller = new AbortController();
    fetch(`/api/takes/${id}/waveform`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Waveform unavailable");
        return response.json();
      })
      .then((data: WaveformPeaks) => {
        if (!controller.signal.aborted) setPeaks(waveformBins(data));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const current = motion.current;
    if (status === "generating") current.generated = true;
    if (status === "complete" && peaks && !current.finishing) {
      if (current.generated) {
        current.finishing = true;
        current.finishTime = current.time;
      } else current.finished = true;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      frame = 0,
      previous = 0,
      visible = true;

    function render() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      if (error) return;
      const elapsed = current.finished
        ? 3.2
        : current.finishing
          ? current.time - current.finishTime
          : 0;
      const convergence = current.finishing || current.finished ? smooth(clamp(elapsed / 1.4)) : 0;
      const emergence =
        current.finishing || current.finished ? smooth(clamp((elapsed - 0.8) / 1.8)) : 0;
      const barsOpacity =
        current.finishing || current.finished ? smooth(clamp((elapsed - 1.8) / 1.2)) : 0;
      const opacity = (1 - barsOpacity) * (status === "queued" ? 0.4 : 1);
      const start = width * 0.075,
        span = width * 0.85;
      const scale = Math.min(1, width / 620);
      const waveHeight = Math.min(height * 0.32, 84);
      if (peaks && barsOpacity > 0) {
        ctx.strokeStyle = `rgba(174,213,191,${barsOpacity * 0.88})`;
        ctx.lineWidth = Math.max(1, Math.min(2, (span / bins) * 0.6));
        ctx.beginPath();
        peaks.forEach((peak, j) => {
          const x = start + (j / (bins - 1)) * span;
          const top = height / 2 - peak.max * waveHeight * emergence;
          const bottom = height / 2 - peak.min * waveHeight * emergence;
          ctx.moveTo(x, top);
          ctx.lineTo(x, Math.max(top + 0.7, bottom));
        });
        ctx.stroke();
      }
      if (opacity <= 0) return;
      for (let i = 0; i < threads.length; i++) {
        const line = threads[i];
        const color = line.color
          .map((channel, k) => Math.round(channel + (threads[0].color[k] - channel) * emergence))
          .join(",");
        const points: { x: number; y: number; u: number; edge: number }[] = [];
        const packet = ((current.time * (0.058 + i * 0.009) + i * 0.29) % 1.5) - 0.25;
        for (let j = 0; j < bins; j++) {
          const u = j / (bins - 1);
          const edge = Math.pow(Math.sin(Math.PI * u), 0.7);
          const phase = current.time * line.speed + line.phase;
          const shape =
            Math.sin(u * Math.PI * 2 * line.period + phase) * 0.72 +
            Math.sin(u * Math.PI * 2 * line.period * 0.51 - phase * 0.63 + i) * 0.28;
          const peak = peaks?.[j];
          const target = peak ? -(i % 2 ? peak.min : peak.max) * waveHeight : 0;
          const y =
            height / 2 +
            (shape * line.amplitude * scale * edge + (i - 1.5) * 2.5) * (1 - convergence) +
            target * emergence;
          points.push({ x: start + u * span, y, u, edge });
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const fade = ctx.createLinearGradient(start, 0, start + span, 0);
        fade.addColorStop(0, `rgba(${color},${emergence * 0.43 * opacity})`);
        fade.addColorStop(0.13, `rgba(${color},${0.43 * opacity})`);
        fade.addColorStop(0.87, `rgba(${color},${0.43 * opacity})`);
        fade.addColorStop(1, `rgba(${color},${emergence * 0.43 * opacity})`);
        ctx.strokeStyle = fade;
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        points.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        if (convergence < 1 && status !== "queued") {
          for (let j = 1; j < points.length; j++) {
            const p = points[j],
              last = points[j - 1];
            const brightness =
              Math.exp(-Math.pow((p.u - packet) / 0.074, 2)) * p.edge * opacity * (1 - convergence);
            if (brightness < 0.02) continue;
            ctx.beginPath();
            ctx.moveTo(last.x, last.y);
            ctx.lineTo(p.x, p.y);
            ctx.strokeStyle = `rgba(${line.color.join(",")},${brightness * 0.065})`;
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.strokeStyle = `rgba(${line.color.join(",")},${brightness * 0.11})`;
            ctx.lineWidth = 4;
            ctx.stroke();
            ctx.strokeStyle = `rgba(${line.color.join(",")},${brightness * 0.8})`;
            ctx.lineWidth = 1.45;
            ctx.stroke();
          }
        }
      }
    }
    function tick(now: number) {
      frame = 0;
      if (previous) current.time += Math.min((now - previous) / 1000, 0.05);
      previous = now;
      if (current.finishing && current.time - current.finishTime >= 3.2) current.finished = true;
      render();
      if (!current.finished) frame = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (reduced.matches && current.finishing) current.finished = true;
      render();
      const active =
        status === "generating" ||
        (status === "complete" && current.generated && !current.finished && !error);
      if (active && visible && !document.hidden && !reduced.matches)
        frame = requestAnimationFrame(tick);
    }
    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    }
    const resizeObserver = new ResizeObserver(resize);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    resizeObserver.observe(canvas);
    intersection.observe(canvas);
    reduced.addEventListener("change", resume);
    document.addEventListener("visibilitychange", resume);
    resize();
    resume();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [status, peaks, error]);

  return error ? (
    <p className="studio-error">Waveform unavailable. You can still audition this take.</p>
  ) : (
    <canvas
      ref={canvasRef}
      className="take-signal"
      role="img"
      aria-label={
        status === "complete"
          ? peaks
            ? "Waveform of this take"
            : "Loading waveform"
          : status === "queued"
            ? "Waiting to generate"
            : "Voice synthesis in progress"
      }
    />
  );
}

export default memo(TakeSignal);
