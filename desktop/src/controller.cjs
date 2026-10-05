const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { createHash, randomUUID } = require("node:crypto");
const net = require("node:net");
const { watchRuntimeActivity } = require("./runtime-activity.cjs");

const MODELS = [
  ["Base", "fd4b254389122332181a7c3db7f27e918eec64e3", "qwen-base"],
  ["VoiceDesign", "5ecdb67327fd37bb2e042aab12ff7391903235d3", "qwen-design"],
];
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function inside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  );
}
function validateLocations(settings, root) {
  for (const key of ["models", "library"]) {
    if (typeof settings[key] !== "string" || !path.isAbsolute(settings[key]))
      throw new Error("Choose an absolute folder location.");
    if (inside(path.join(root, "runtimes"), settings[key]))
      throw new Error("Keep models and your library outside application runtime storage.");
  }
  if (inside(settings.models, settings.library) || inside(settings.library, settings.models))
    throw new Error("Choose separate folders for models and the library.");
  return {
    models: path.resolve(settings.models),
    library: path.resolve(settings.library),
    design: Boolean(settings.design),
  };
}
async function availableBytes(location) {
  let current = location;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  try {
    const stats = await fsp.statfs(current);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
class DesktopController {
  constructor({
    root,
    resources,
    node,
    helpers,
    onState = () => {},
    devConfig = null,
    runner = null,
  }) {
    this.root = path.resolve(root);
    this.resources = resources;
    this.node = node;
    this.helpers = helpers;
    this.onState = onState;
    this.devConfig = devConfig;
    this.runner = runner;
    this.file = path.join(this.root, "installation.json");
    this.config = readJson(this.file);
    this.planFile = path.join(this.root, "setup-plan.json");
    const plan = readJson(this.planFile);
    this.children = [];
    this.operation = null;
    this.paused = false;
    this.stopping = false;
    this.pendingFile = path.join(this.root, "pending-runtime.json");
    this.state = {
      view: "checking",
      busy: false,
      settings: this.config?.settings ||
        plan || {
          models: path.join(this.root, "Models"),
          library: path.join(this.root, "Library"),
          design: true,
        },
      device: null,
      download: null,
      stage: "Checking installation",
      logs: [],
      error: null,
    };
    if (
      !this.config &&
      !plan &&
      devConfig &&
      path.dirname(devConfig.modelPath) === path.dirname(devConfig.designModelPath)
    )
      this.state.settings.models = path.dirname(devConfig.modelPath);
    fs.mkdirSync(path.join(this.root, "logs"), { recursive: true });
  }
  emit(patch = {}) {
    Object.assign(this.state, patch);
    this.state.designInstalled = Boolean(this.config?.settings.design);
    this.state.libraryAvailable = fs.existsSync(this.state.settings.library);
    this.state.modelsAvailable = fs.existsSync(
      path.join(this.state.settings.models, "qwen-base/spike-source.json")
    );
    this.onState({ ...this.state, logs: this.state.logs.slice(-40) });
    return this.state;
  }
  log(line) {
    const cleaned = line.replace(/\x1b\[[0-9;]*m/g, "");
    this.state.logs.push(cleaned);
    if (this.state.logs.length > 200) this.state.logs.shift();
    fs.appendFileSync(
      path.join(this.root, "logs/desktop.log"),
      `${new Date().toISOString()} ${cleaned}\n`
    );
  }
  async execute(command, args, options = {}, onLine = () => {}) {
    if (this.runner) return this.runner(command, args, options, onLine);
    this.log(`Starting ${path.basename(command)} ${args[0] || ""}`);
    const child = spawn(command, args, {
      ...options,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.children.push(child);
    this.operation = child;
    return new Promise((resolve, reject) => {
      let output = "";
      for (const stream of [child.stdout, child.stderr])
        createInterface({ input: stream }).on("line", (line) => {
          output = (output + line + "\n").slice(-128 * 1024);
          this.log(line);
          onLine(line);
        });
      child.once("error", reject);
      child.once("close", (code) => {
        this.children = this.children.filter((c) => c !== child);
        if (this.operation === child) this.operation = null;
        this.log(`${path.basename(command)} exited (${code})`);
        if (code === 0) resolve(output);
        else reject(new Error(output.trim().slice(-1200) || `Process exited (${code})`));
      });
    });
  }
  environment(settings = this.state.settings) {
    return {
      ...process.env,
      PATH: path.join(this.resources, "bin") + path.delimiter + process.env.PATH,
      PYTHONUNBUFFERED: "1",
      HF_HOME: path.join(this.root, "cache/huggingface"),
      UV_CACHE_DIR: path.join(this.root, "cache/uv"),
      UV_PYTHON_INSTALL_DIR: path.join(this.root, "python"),
      UV_LINK_MODE: "copy",
      VIBEPOD_DATA_DIR: settings.library,
      VIBEPOD_MODEL_PATH: path.join(settings.models, "qwen-base"),
      VIBEPOD_DESIGN_MODEL_PATH: path.join(settings.models, "qwen-design"),
    };
  }
  async device() {
    const exe =
      process.platform === "win32"
        ? path.join(process.env.SystemRoot || "C:\\Windows", "System32/nvidia-smi.exe")
        : "nvidia-smi";
    const text = await this.execute(exe, [
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader,nounits",
    ]);
    const [name, memory, driver] = text
      .trim()
      .split("\n")[0]
      .split(",")
      .map((s) => s.trim());
    const vram = Number(memory) / 1024;
    if (!Number.isFinite(vram) || vram < 11)
      throw new Error("A supported NVIDIA GPU with at least 12 GB VRAM is required.");
    return { name, vram, driver };
  }
  async check() {
    if (this.state.busy) return this.state;
    this.emit({ view: "checking", busy: true, error: null, stage: "Checking graphics device" });
    try {
      const device = await this.device();
      this.emit({ device, available: await availableBytes(this.state.settings.models) });
      if (this.config) {
        const hash = createHash("sha256")
          .update(fs.readFileSync(path.join(this.resources, "server/uv.lock")))
          .digest("hex");
        if (this.config.manifestHash !== hash)
          throw new Error(
            "The engine dependencies changed. Repair the engine to apply this application version."
          );
        await this.execute(this.config.python, ["doctor.py"], {
          cwd: path.join(this.resources, "server"),
          env: this.environment(),
        });
        for (const [variant, revision, folder] of MODELS) {
          if (variant === "VoiceDesign" && !this.state.settings.design) continue;
          const dir = path.join(this.state.settings.models, folder);
          const source = readJson(path.join(dir, "spike-source.json"));
          if (
            source?.revision !== revision ||
            !fs.existsSync(path.join(dir, "config.json")) ||
            !fs.readdirSync(dir).some((file) => file.endsWith(".safetensors"))
          ) {
            const error = new Error(
              "Required voice model files are missing. Resume model setup to verify and restore them."
            );
            error.kind = "download";
            throw error;
          }
        }
        this.emit({
          view: "ready",
          busy: false,
          configured: true,
          engineVerified: true,
          completed: this.state.settings.design ? ["Base", "VoiceDesign"] : ["Base"],
          stage: "Ready",
        });
      } else
        this.emit({ view: "setup", busy: false, configured: false, stage: "Set up your Studio" });
    } catch (error) {
      this.fail(
        error,
        error.kind || (/CUDA|driver|nvidia|GPU|VRAM/i.test(error.message) ? "driver" : "runtime")
      );
    }
    return this.state;
  }
  fail(error, kind = "runtime") {
    this.log(error.message);
    this.emit({
      view: "repair",
      busy: false,
      error: { kind, message: error.message },
      stage: "Startup needs attention",
    });
  }
  async configure(settings) {
    if (this.config)
      throw new Error(
        "Installed library locations are retained. Changing them requires a migration."
      );
    this.state.settings = validateLocations(settings, this.root);
    atomicJson(this.planFile, this.state.settings);
    this.emit({ available: await availableBytes(settings.models) });
  }
  async runtime(repair = false) {
    if (!repair && this.config && fs.existsSync(this.config.python)) return this.config.python;
    const candidate = path.join(this.root, "runtimes", `engine-${randomUUID()}`);
    const python = path.join(candidate, "Scripts/python.exe");
    const env = { ...this.environment(), UV_PROJECT_ENVIRONMENT: candidate };
    this.emit({ stage: "Installing voice engine", component: "engine", download: null });
    const pending = readJson(this.pendingFile);
    const hash = createHash("sha256")
      .update(fs.readFileSync(path.join(this.resources, "server/uv.lock")))
      .digest("hex");
    if (!repair && pending?.manifestHash === hash && fs.existsSync(pending.python)) {
      await this.execute(pending.python, ["doctor.py"], {
        cwd: path.join(this.resources, "server"),
        env,
      });
      this.emit({ engineVerified: true });
      return pending.python;
    }
    if (this.devConfig && !repair && fs.existsSync(this.devConfig.python)) {
      // Development can use its verified environment without copying or modifying it.
      await this.execute(this.devConfig.python, ["doctor.py"], {
        cwd: path.join(this.resources, "server"),
        env,
      });
      this.emit({ engineVerified: true });
      atomicJson(this.pendingFile, { python: this.devConfig.python, manifestHash: hash });
      return this.devConfig.python;
    }
    this.emit({ stage: "Preparing Python and GPU packages", engineActivity: null });
    const stopActivity = watchRuntimeActivity(
      [env.UV_PYTHON_INSTALL_DIR, env.UV_CACHE_DIR, candidate],
      (activity) => this.emit({ engineActivity: activity }),
      1000,
      (error) => this.log(`Runtime activity watcher: ${error.message}`)
    );
    try {
      await this.execute(
        path.join(this.resources, "bin/uv.exe"),
        [
          "sync",
          "--frozen",
          "--no-dev",
          "--managed-python",
          "--python",
          "3.12.9",
          "--verbose",
          "--no-progress",
          "--color",
          "never",
        ],
        { cwd: path.join(this.resources, "server"), env },
        (line) => {
          const readable = line.replace(/^DEBUG\s+/, "").trim();
          if (
            /^(Downloading|Downloaded|Preparing|Prepared|Installing|Installed)\b/.test(readable) &&
            !/https?:\/\//.test(readable)
          )
            this.emit({ stage: readable.slice(0, 160) });
        }
      );
    } finally {
      stopActivity();
    }
    this.emit({ stage: "Verifying voice engine", engineActivity: null });
    await this.execute(python, ["doctor.py"], { cwd: path.join(this.resources, "server"), env });
    this.emit({ engineVerified: true });
    atomicJson(this.pendingFile, { python, manifestHash: hash });
    return python;
  }
  async install(settings = this.state.settings, repair = false) {
    if (this.state.busy) throw new Error("An operation is already running.");
    settings = validateLocations(
      this.config
        ? {
            ...this.config.settings,
            design: this.config.settings.design || Boolean(settings.design),
          }
        : settings,
      this.root
    );
    this.paused = false;
    atomicJson(this.planFile, settings);
    this.emit({
      view: "install",
      busy: true,
      paused: false,
      settings,
      error: null,
      repair,
      completed: [],
      component: "engine",
      stage: repair ? "Repairing voice engine" : "Installing voice engine",
    });
    try {
      fs.mkdirSync(settings.library, { recursive: true });
      fs.mkdirSync(settings.models, { recursive: true });
      const python = await this.runtime(repair);
      if (!repair) {
        for (const [variant, revision, folder] of MODELS) {
          if (variant === "VoiceDesign" && !settings.design) continue;
          this.emit({
            component: variant,
            stage: `Downloading ${variant === "Base" ? "core voice" : "voice design"} model`,
            download: null,
          });
          await this.execute(
            python,
            [
              "download_model.py",
              `Qwen/Qwen3-TTS-12Hz-1.7B-${variant}`,
              path.join(settings.models, folder),
              "--revision",
              revision,
              "--progress-json",
            ],
            { cwd: path.join(this.resources, "server"), env: this.environment(settings) },
            (line) => {
              try {
                const progress = JSON.parse(line);
                if (progress.event === "model_progress")
                  this.emit({
                    download: progress,
                    stage:
                      progress.phase === "verifying"
                        ? "Verifying model files"
                        : "Downloading voice model",
                  });
              } catch {}
            }
          );
          this.emit({ completed: [...this.state.completed, variant] });
        }
      }
      this.emit({ stage: "Verifying installation", download: null });
      await this.execute(python, ["doctor.py"], {
        cwd: path.join(this.resources, "server"),
        env: this.environment(settings),
      });
      const manifestHash = createHash("sha256")
        .update(fs.readFileSync(path.join(this.resources, "server/uv.lock")))
        .digest("hex");
      const config = {
        python,
        settings,
        manifestHash,
        previousRuntime: this.config?.python || null,
      };
      atomicJson(this.file, config);
      this.config = config;
      this.emit({
        view: "ready",
        busy: false,
        configured: true,
        stage: "Ready",
        engineVerified: true,
      });
    } catch (error) {
      if (this.paused) this.emit({ busy: false, stage: "Download paused", paused: true });
      else
        this.fail(
          error,
          /CUDA|driver|GPU/i.test(error.message)
            ? "driver"
            : this.state.component === "engine"
              ? "runtime"
              : "download"
        );
    }
    return this.state;
  }
  async pause() {
    if (!this.state.busy || !["Base", "VoiceDesign"].includes(this.state.component))
      throw new Error("Only model downloads can be paused.");
    this.paused = true;
    const helper = await import(this.helpers);
    if (this.operation) helper.stopChild(this.operation);
  }
  async start() {
    if (this.state.busy || !this.config) throw new Error("Finish setup before opening the Studio.");
    this.emit({
      view: "install",
      busy: true,
      stage: "Starting your Studio",
      download: null,
      component: "startup",
    });
    this.stopping = false;
    const { startChild, stopChild, waitReady, assertPortAvailable } = await import(this.helpers);
    let startupKind = "runtime";
    try {
      const backendPort = await freePort();
      let webPort = await freePort();
      while (webPort === backendPort) webPort = await freePort();
      await assertPortAvailable(backendPort);
      await assertPortAvailable(webPort);
      const env = {
        ...this.environment(),
        PORT: String(webPort),
        HOSTNAME: "127.0.0.1",
        VIBEPOD_SERVER_URL: `http://127.0.0.1:${backendPort}`,
        ELECTRON_RUN_AS_NODE: "1",
      };
      const start = (name, command, args, cwd) => {
        const child = startChild(name, command, args, { cwd, env });
        this.children.push(child);
        for (const stream of [child.stdout, child.stderr])
          createInterface({ input: stream }).on("line", (line) => this.log(`[${name}] ${line}`));
        child.once("exit", (code) => {
          if (!this.stopping && this.state.view === "studio") {
            this.stop().then(() =>
              this.fail(new Error(`${name} exited (${code}). View the startup log for details.`))
            );
          }
        });
        return child;
      };
      const backend = start(
        "Voice engine",
        this.config.python,
        [
          "-m",
          "uvicorn",
          "tts_server:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(backendPort),
          "--no-access-log",
        ],
        path.join(this.resources, "server")
      );
      await waitReady(`http://127.0.0.1:${backendPort}/health`, backend);
      startupKind = "application";
      this.emit({ stage: "Opening the Studio" });
      const web = start(
        "Studio",
        this.node,
        [path.join(this.resources, "web/server.js")],
        path.join(this.resources, "web")
      );
      await waitReady(`http://127.0.0.1:${webPort}/api/health`, web);
      this.emit({ view: "studio", busy: false, url: `http://127.0.0.1:${webPort}` });
      return this.state.url;
    } catch (error) {
      this.children.forEach(stopChild);
      this.children = [];
      this.fail(error, startupKind);
      throw error;
    }
  }
  async stop() {
    this.stopping = true;
    const helper = await import(this.helpers);
    this.children.forEach(helper.stopChild);
    this.children = [];
  }
}
module.exports = { DesktopController, validateLocations, inside, atomicJson, availableBytes };
