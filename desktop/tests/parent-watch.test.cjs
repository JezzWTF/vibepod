const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");
const { DesktopController } = require("../src/controller.cjs");
function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-hardening-"));
}

test("the Studio process exits when the desktop that started it is gone", async () => {
  const parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"]);
  const watcher = spawn(
    process.execPath,
    [
      "--require",
      path.join(__dirname, "../src/parent-watch.cjs"),
      "-e",
      "setInterval(() => {}, 1000)",
    ],
    {
      env: {
        ...process.env,
        VIBEPOD_PARENT_PID: String(parent.pid),
        VIBEPOD_PARENT_POLL_MS: "200",
      },
    }
  );
  const started = Date.now();
  const code = await new Promise((resolve) => watcher.once("exit", resolve));
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 8000);
});

test("without a parent the preload does nothing", () => {
  const result = spawnSync(
    process.execPath,
    ["--require", path.join(__dirname, "../src/parent-watch.cjs"), "-e", "console.log('ok')"],
    { env: { ...process.env, VIBEPOD_PARENT_PID: "" }, encoding: "utf8" }
  );
  assert.equal(result.stdout.trim(), "ok");
});

test("the managed Python never inherits the developer's PYTHONHOME or PYTHONPATH", () => {
  const root = temp();
  const resources = path.join(root, "resources");
  fs.mkdirSync(path.join(resources, "server"), { recursive: true });
  const saved = { home: process.env.PYTHONHOME, path: process.env.PYTHONPATH };
  process.env.PYTHONHOME = "C:\\Python";
  process.env.PYTHONPATH = "C:\\libs";
  try {
    const env = new DesktopController({ root, resources }).environment();
    assert.equal(env.PYTHONHOME, undefined);
    assert.equal(env.PYTHONPATH, undefined);
    assert.equal(env.PYTHONUTF8, "1");
  } finally {
    for (const [name, value] of [
      ["PYTHONHOME", saved.home],
      ["PYTHONPATH", saved.path],
    ])
      value === undefined ? delete process.env[name] : (process.env[name] = value);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
