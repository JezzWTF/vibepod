const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadWindowState, saveWindowState } = require("../src/window-state.cjs");

const display = { x: 0, y: 0, width: 1920, height: 1080 };
const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-window-")), "w.json");

test("a saved window size and position round-trips", () => {
  const f = file();
  saveWindowState(f, { x: 100, y: 50, width: 1400, height: 900, maximized: false });
  assert.deepEqual(loadWindowState(f, [display]), {
    x: 100,
    y: 50,
    width: 1400,
    height: 900,
    maximized: false,
  });
});

test("a missing or corrupt file falls back to defaults", () => {
  assert.equal(loadWindowState(file(), [display]), null);
  const f = file();
  fs.writeFileSync(f, "{nope");
  assert.equal(loadWindowState(f, [display]), null);
});

test("a position on a display that is gone is dropped but the size is kept", () => {
  const f = file();
  saveWindowState(f, { x: 5000, y: 0, width: 1200, height: 800, maximized: true });
  const state = loadWindowState(f, [display]);
  assert.equal(state.x, undefined);
  assert.equal(state.width, 1200);
  assert.equal(state.maximized, true);
});

test("saved sizes never go below the window minimum", () => {
  const f = file();
  saveWindowState(f, { x: 0, y: 0, width: 300, height: 200 });
  const state = loadWindowState(f, [display]);
  assert.equal(state.width, 800);
  assert.equal(state.height, 720);
});
