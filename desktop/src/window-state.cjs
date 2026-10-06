const fs = require("node:fs");
const path = require("node:path");

const MIN = { width: 800, height: 720 };

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Reads the saved window bounds; anything missing, corrupt or off every display is dropped.
function loadWindowState(file, displays = []) {
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!saved || !isNumber(saved.width) || !isNumber(saved.height)) return null;
  const state = {
    width: Math.max(MIN.width, Math.round(saved.width)),
    height: Math.max(MIN.height, Math.round(saved.height)),
    maximized: saved.maximized === true,
  };
  if (isNumber(saved.x) && isNumber(saved.y)) {
    const bounds = { x: Math.round(saved.x), y: Math.round(saved.y), ...state };
    if (displays.some((area) => intersects(bounds, area))) {
      state.x = bounds.x;
      state.y = bounds.y;
    }
  }
  return state;
}

function saveWindowState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Losing the window size is not worth interrupting the app.
  }
}

// Keeps `window`'s size and position in `file`, writing at most once per `delay` ms.
function trackWindowState(window, file, delay = 400) {
  let timer;
  const snapshot = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return null;
    const maximized = window.isMaximized();
    return { ...window.getNormalBounds(), maximized };
  };
  const flush = () => {
    clearTimeout(timer);
    const state = snapshot();
    if (state) saveWindowState(file, state);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize"]) window.on(event, schedule);
  window.on("close", flush);
}

module.exports = { loadWindowState, saveWindowState, trackWindowState };
