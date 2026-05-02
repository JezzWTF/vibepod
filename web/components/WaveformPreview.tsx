"use client";

import { useEffect, useRef } from "react";
import type { WaveformPeaks } from "@/lib/types/generation";

interface WaveformPreviewProps {
  peaks: WaveformPeaks;
  color?: string;
  height?: number;
  className?: string;
}

export default function WaveformPreview({
  peaks,
  color = "#2dd4bf",
  height = 48,
  className = "",
}: WaveformPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width } = canvas;
    const midY = height / 2;
    const { min, max } = peaks.data;
    const len = peaks.length;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    for (let x = 0; x < width; x++) {
      const peakIndex = Math.floor((x / width) * len);
      const minY = midY - min[peakIndex] * midY;
      const maxY = midY - max[peakIndex] * midY;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, Math.min(minY, maxY));
      ctx.lineTo(x + 0.5, Math.max(minY, maxY));
      ctx.stroke();
    }
  }, [peaks, color, height]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={height}
      className={`w-full ${className}`}
      style={{ height }}
    />
  );
}
