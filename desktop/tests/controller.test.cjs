const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { DesktopController, validateLocations, atomicJson } = require("../src/controller.cjs");
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-desktop-"));
  const resources = path.join(root, "resources");
  fs.mkdirSync(path.join(resources, "server"), { recursive: true });
  fs.writeFileSync(path.join(resources, "server/uv.lock"), "locked");
  return { root, resources };
}
function clean(root) {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("vibepod-desktop-"));
  fs.rmSync(root, { recursive: true, force: true });
}
test("storage locations cannot overlap each other or the managed runtime", () => {
  const { root } = fixture();
  try {
    assert.throws(
      () =>
        validateLocations(
          { models: path.join(root, "runtimes/model"), library: path.join(root, "Library") },
          root
        ),
      /outside/
    );
    assert.throws(
      () =>
        validateLocations(
          { models: path.join(root, "Models"), library: path.join(root, "Models/library") },
          root
        ),
      /separate/
    );
    assert.throws(
      () => validateLocations({ models: "relative", library: path.join(root, "Library") }, root),
      /absolute/
    );
  } finally {
    clean(root);
  }
});
test("failed repair preserves installation pointer, library and existing models", async () => {
  const { root, resources } = fixture();
  try {
    const settings = {
      models: path.join(root, "Models"),
      library: path.join(root, "Library"),
      design: true,
    };
    fs.mkdirSync(settings.library);
    fs.mkdirSync(settings.models);
    fs.writeFileSync(path.join(settings.library, "episode.db"), "valuable episode");
    fs.writeFileSync(path.join(settings.models, "model"), "valuable weights");
    const installed = { python: path.join(root, "old/python.exe"), settings, manifestHash: "old" };
    atomicJson(path.join(root, "installation.json"), installed);
    const c = new DesktopController({
      root,
      resources,
      runner: async () => {
        throw new Error("network interrupted");
      },
    });
    await c.install(settings, true);
    assert.equal(c.state.view, "repair");
    assert.deepEqual(JSON.parse(fs.readFileSync(c.file)), installed);
    assert.equal(
      fs.readFileSync(path.join(settings.library, "episode.db"), "utf8"),
      "valuable episode"
    );
    assert.equal(fs.readFileSync(path.join(settings.models, "model"), "utf8"), "valuable weights");
  } finally {
    clean(root);
  }
});
test("repair commits only verified candidate and does not download or remove models", async () => {
  const { root, resources } = fixture();
  try {
    const settings = {
      models: path.join(root, "Models"),
      library: path.join(root, "Library"),
      design: true,
    };
    const old = path.join(root, "old/python.exe");
    atomicJson(path.join(root, "installation.json"), { python: old, settings });
    const calls = [];
    const c = new DesktopController({
      root,
      resources,
      runner: async (command, args, options) => {
        calls.push(args);
        if (args[0] === "sync") {
          fs.mkdirSync(path.join(options.env.UV_PROJECT_ENVIRONMENT, "Scripts"), {
            recursive: true,
          });
          fs.writeFileSync(
            path.join(options.env.UV_PROJECT_ENVIRONMENT, "Scripts/python.exe"),
            "candidate"
          );
        }
        return "okay";
      },
    });
    await c.install(settings, true);
    assert.equal(c.state.view, "ready");
    assert.notEqual(c.config.python, old);
    assert.equal(c.config.previousRuntime, old);
    assert.equal(calls.filter((args) => args[0] === "doctor.py").length, 2);
    assert.ok(!calls.some((args) => args[0] === "download_model.py"));
    assert.equal(c.config.settings.library, settings.library);
  } finally {
    clean(root);
  }
});
test("actual downloader byte events reach state and optional design can be installed later", async () => {
  const { root, resources } = fixture();
  try {
    const verifiedPython = path.join(root, "dev/python.exe");
    fs.mkdirSync(path.dirname(verifiedPython));
    fs.writeFileSync(verifiedPython, "python");
    const calls = [];
    const c = new DesktopController({
      root,
      resources,
      devConfig: {
        python: verifiedPython,
        modelPath: path.join(root, "Models/qwen-base"),
        designModelPath: path.join(root, "Models/qwen-design"),
      },
      runner: async (command, args, options, line) => {
        calls.push(args);
        if (args[0] === "download_model.py")
          line(
            JSON.stringify({
              event: "model_progress",
              phase: "downloading",
              downloaded: 64,
              total: 100,
            })
          );
        return "okay";
      },
    });
    await c.install({ ...c.state.settings, design: false });
    assert.equal(c.state.view, "ready");
    assert.ok(calls.some((args) => args.includes("Qwen/Qwen3-TTS-12Hz-1.7B-Base")));
    assert.ok(!calls.some((args) => args.includes("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")));
    assert.deepEqual(c.state.download, null);
    await c.install({ ...c.state.settings, design: true });
    assert.ok(calls.some((args) => args.includes("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")));
    assert.equal(c.config.settings.design, true);
  } finally {
    clean(root);
  }
});
test("changed engine lock sends installation to repair", async () => {
  const { root, resources } = fixture();
  try {
    const settings = {
      models: path.join(root, "Models"),
      library: path.join(root, "Library"),
      design: false,
    };
    atomicJson(path.join(root, "installation.json"), {
      python: "old",
      settings,
      manifestHash: "wrong",
    });
    const c = new DesktopController({
      root,
      resources,
      runner: async () => "NVIDIA GPU, 12288, 600.1",
    });
    await c.check();
    assert.equal(c.state.view, "repair");
    assert.match(c.state.error.message, /dependencies changed/);
  } finally {
    clean(root);
  }
});

test("interrupted first setup retains chosen storage after application restart", async () => {
  const { root, resources } = fixture();
  try {
    const settings = {
      models: path.join(root, "SelectedModels"),
      library: path.join(root, "SelectedLibrary"),
      design: false,
    };
    const c = new DesktopController({
      root,
      resources,
      runner: async () => {
        throw new Error("offline");
      },
    });
    await c.install(settings);
    assert.equal(c.config, null);
    const restarted = new DesktopController({ root, resources });
    assert.deepEqual(restarted.state.settings, settings);
  } finally {
    clean(root);
  }
});

test("silent subprocesses still leave persistent start and exit records", async () => {
  const { root, resources } = fixture();
  try {
    const c = new DesktopController({ root, resources });
    const output = await c.execute(process.execPath, ["-e", "process.exit(0)"]);
    assert.equal(output, "");
    const log = fs.readFileSync(path.join(root, "logs/desktop.log"), "utf8");
    assert.match(log, /Starting .* -e/);
    assert.match(log, /exited \(0\)/);
    assert.equal(c.children.length, 0);
  } finally {
    clean(root);
  }
});
test("graphics cards with 8 GB or more are accepted and smaller ones are refused", async () => {
  const { root, resources } = fixture();
  try {
    const gpu = (mib) =>
      new DesktopController({ root, resources, runner: async () => `NVIDIA GPU, ${mib}, 600.1` });
    assert.equal((await gpu(8188).device()).vram.toFixed(1), "8.0");
    assert.equal((await gpu(12282).device()).name, "NVIDIA GPU");
    await assert.rejects(() => gpu(6144).device(), /at least 8 GB VRAM/);
  } finally {
    clean(root);
  }
});
test("startup checks every model file against the recorded sizes", async () => {
  const { root, resources } = fixture();
  try {
    const settings = {
      models: path.join(root, "Models"),
      library: path.join(root, "Library"),
      design: false,
    };
    const base = path.join(settings.models, "qwen-base");
    const files = { "config.json": 2, "tokenizer.json": 5, "model.safetensors": 8 };
    const write = (name, size) => fs.writeFileSync(path.join(base, name), "x".repeat(size));
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(settings.library);
    const manifest = (extra = {}) =>
      fs.writeFileSync(
        path.join(base, "spike-source.json"),
        JSON.stringify({ revision: "fd4b254389122332181a7c3db7f27e918eec64e3", ...extra })
      );
    for (const [name, size] of Object.entries(files)) write(name, size);
    atomicJson(path.join(root, "installation.json"), {
      python: path.join(root, "python.exe"),
      settings,
      manifestHash: createHash("sha256").update("locked").digest("hex"),
    });
    const c = new DesktopController({
      root,
      resources,
      runner: async () => "NVIDIA GPU, 12288, 600.1",
    });
    manifest({ files });
    await c.check();
    assert.equal(c.state.view, "ready");

    fs.rmSync(path.join(base, "tokenizer.json"));
    await c.check();
    assert.equal(c.state.view, "repair");
    assert.equal(c.state.error.kind, "download");
    assert.match(c.state.error.message, /missing or incomplete/);

    write("tokenizer.json", 5);
    write("model.safetensors", 3);
    await c.check();
    assert.equal(c.state.error.kind, "download", "a truncated weights file is caught");

    write("model.safetensors", 8);
    await c.check();
    assert.equal(c.state.view, "ready");

    fs.rmSync(path.join(base, "tokenizer.json"));
    manifest();
    await c.check();
    assert.equal(c.state.view, "ready", "a folder from an older download keeps the basic check");
  } finally {
    clean(root);
  }
});
