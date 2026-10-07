// The Studio's "generating" signal (web/components/TakeSignal.tsx), reused for the launch screen.
const threads = [
  { color: [174, 213, 191], amplitude: 25, period: 1.18, speed: 0.31, phase: 0.2 },
  { color: [139, 166, 182], amplitude: 31, period: 1.43, speed: -0.24, phase: 2 },
  { color: [194, 190, 166], amplitude: 20, period: 0.91, speed: 0.27, phase: 4.1 },
  { color: [161, 183, 171], amplitude: 28, period: 1.67, speed: -0.19, phase: 5.6 },
];
const bins = 240;

function startThreads(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let width = 0;
  let height = 0;
  let time = 0;
  let previous = 0;
  let frame = 0;

  function render() {
    ctx.clearRect(0, 0, width, height);
    const start = width * 0.02;
    const span = width * 0.96;
    const scale = Math.min(1, width / 620);
    threads.forEach((line, i) => {
      const packet = ((time * (0.058 + i * 0.009) + i * 0.29) % 1.5) - 0.25;
      const points = [];
      for (let j = 0; j < bins; j++) {
        const u = j / (bins - 1);
        const edge = Math.pow(Math.sin(Math.PI * u), 0.7);
        const phase = time * line.speed + line.phase;
        const shape =
          Math.sin(u * Math.PI * 2 * line.period + phase) * 0.72 +
          Math.sin(u * Math.PI * 2 * line.period * 0.51 - phase * 0.63 + i) * 0.28;
        points.push({
          x: start + u * span,
          y: height / 2 + shape * line.amplitude * scale * edge + (i - 1.5) * 2.5,
          u,
          edge,
        });
      }
      const rgb = line.color.join(",");
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const fade = ctx.createLinearGradient(start, 0, start + span, 0);
      fade.addColorStop(0, `rgba(${rgb},0)`);
      fade.addColorStop(0.13, `rgba(${rgb},0.43)`);
      fade.addColorStop(0.87, `rgba(${rgb},0.43)`);
      fade.addColorStop(1, `rgba(${rgb},0)`);
      ctx.strokeStyle = fade;
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      points.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      if (reduced.matches) return;
      for (let j = 1; j < points.length; j++) {
        const p = points[j];
        const last = points[j - 1];
        const brightness = Math.exp(-Math.pow((p.u - packet) / 0.074, 2)) * p.edge;
        if (brightness < 0.02) continue;
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(p.x, p.y);
        for (const [alpha, lineWidth] of [
          [0.065, 10],
          [0.11, 4],
          [0.8, 1.45],
        ]) {
          ctx.strokeStyle = `rgba(${rgb},${brightness * alpha})`;
          ctx.lineWidth = lineWidth;
          ctx.stroke();
        }
      }
    });
  }
  function tick(now) {
    frame = 0;
    if (previous) time += Math.min((now - previous) / 1000, 0.05);
    previous = now;
    render();
    schedule();
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = 0;
    // The canvas has no size while its screen is hidden, so the loop idles until it appears.
    if (!reduced.matches && !document.hidden && width > 0) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    previous = 0;
    render();
    schedule();
  }
  new ResizeObserver(resize).observe(canvas);
  reduced.addEventListener("change", schedule);
  document.addEventListener("visibilitychange", schedule);
}

const launchSignal = document.getElementById("launch-signal");
if (launchSignal) startThreads(launchSignal);
