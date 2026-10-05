import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function lockHash(directory = root) {
  return createHash("sha256")
    .update(readFileSync(path.join(directory, "server/uv.lock")))
    .update(readFileSync(path.join(directory, "pnpm-lock.yaml")))
    .digest("hex");
}
export function loadConfig(directory = root) {
  const file = path.join(directory, ".vibepod/config.json");
  if (!existsSync(file)) throw new Error("Run ./setup.ps1 first. See docs/windows-development.md.");
  const config = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  if (config.lockHash !== lockHash(directory))
    throw new Error("Dependencies changed. Rerun ./setup.ps1.");
  for (const key of ["backendPort", "webPort"]) {
    if (!Number.isInteger(config[key]) || config[key] < 1024 || config[key] > 65535)
      throw new Error(`${key} must be an integer between 1024 and 65535.`);
  }
  if (config.backendPort === config.webPort)
    throw new Error("Use different backend and web ports.");
  for (const key of ["python", "modelPath", "designModelPath", "hfHome"]) {
    if (typeof config[key] !== "string" || !path.isAbsolute(config[key]))
      throw new Error(`${key} must be an absolute path. Rerun ./setup.ps1.`);
  }
  if (!existsSync(config.python)) throw new Error("Python environment missing. Rerun ./setup.ps1.");
  return config;
}
export async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop its server or change .vibepod/config.json. No existing process was stopped.`
        )
      )
    );
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
export async function waitReady(url, child, timeout = 90000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (child.spawnError) throw child.spawnError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Service exited before readiness: ${url}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* quiet, bounded startup readiness only */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${url}. Inspect .vibepod/logs.`);
}
export function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } else child.kill("SIGTERM");
}
export function startChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    // Lets a service notice that this launcher is gone and exit with it.
    env: { ...(options.env ?? process.env), VIBEPOD_PARENT_PID: String(process.pid) },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    child.spawnError = error;
    console.error(`[${name}] ${error.message}`);
  });
  return child;
}
function attachLogs(name, child, directory, verbose) {
  const file = createWriteStream(path.join(directory, `${name}.log`), { flags: "a" });
  for (const stream of [child.stdout, child.stderr]) {
    const lines = createInterface({ input: stream });
    lines.on("line", (line) => {
      file.write(`${new Date().toISOString()} ${line}\n`);
      if (verbose || !/^\s*(GET|POST|PUT|DELETE|PATCH|HEAD) \/.* \d{3}/.test(line))
        console.log(`[${name}] ${line}`);
    });
  }
  child.once("close", () => file.end());
}
export async function main({ directory = root, args = process.argv.slice(2) } = {}) {
  const config = loadConfig(directory);
  const env = {
    ...process.env,
    HF_HOME: config.hfHome,
    VIBEPOD_MODEL_PATH: config.modelPath,
    VIBEPOD_DESIGN_MODEL_PATH: config.designModelPath,
    VIBEPOD_SERVER_URL: `http://127.0.0.1:${config.backendPort}`,
    PYTHONUNBUFFERED: "1",
    PYTHONUTF8: "1",
  };
  // A developer's own Python settings must not reach the managed interpreter.
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  // Empty paths allow the adapter's pinned Hub fallback after -SkipModels.
  for (const key of ["VIBEPOD_MODEL_PATH", "VIBEPOD_DESIGN_MODEL_PATH"])
    if (!existsSync(env[key])) delete env[key];
  const check = spawnSync(config.python, ["doctor.py"], {
    cwd: path.join(directory, "server"),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (check.status !== 0) throw new Error("Runtime check failed. See docs/windows-development.md.");
  const next = path.join(directory, "web/node_modules/next/dist/bin/next");
  if (!existsSync(next)) throw new Error("Frontend dependencies missing. Rerun ./setup.ps1.");
  if (args.includes("--check")) {
    console.log(
      `[check] Configuration and dependencies ready. Ports: ${config.webPort}/${config.backendPort}`
    );
    return;
  }
  await assertPortAvailable(config.backendPort);
  await assertPortAvailable(config.webPort);
  const logRoot = path.join(directory, ".vibepod/logs");
  mkdirSync(logRoot, { recursive: true });
  const children = [];
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(
      "[studio] Stopping owned services. Unfinished jobs will be marked interrupted on restart."
    );
    children.forEach(stopChild);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const start = (name, command, serviceArgs, cwd) => {
    const child = startChild(name, command, serviceArgs, { cwd, env });
    children.push(child);
    attachLogs(name, child, logRoot, args.includes("--verbose"));
    child.once("exit", (code) => {
      if (!stopping) {
        console.error(`[studio] ${name} exited (${code}). Stopping the other service.`);
        process.exitCode = 1;
        stop();
      }
    });
    return child;
  };
  try {
    console.log("[studio] Starting Python backend");
    const backend = start(
      "python",
      config.python,
      [
        "-m",
        "uvicorn",
        "tts_server:app",
        "--host",
        "127.0.0.1",
        "--port",
        String(config.backendPort),
        "--no-access-log",
      ],
      path.join(directory, "server")
    );
    await waitReady(`http://127.0.0.1:${config.backendPort}/health`, backend);
    if (stopping) return;
    console.log("[studio] Backend ready. Starting Next.js");
    const web = start(
      "next",
      process.execPath,
      [next, "dev", "--hostname", "127.0.0.1", "--port", String(config.webPort)],
      path.join(directory, "web")
    );
    await waitReady(`http://127.0.0.1:${config.webPort}/api/health`, web);
    if (stopping) return;
    console.log(`[studio] Ready: http://127.0.0.1:${config.webPort} · Ctrl+C stops both services`);
    console.log(`[studio] Full logs: ${logRoot}. Add --verbose to show request logs.`);
    return { stop };
  } catch (error) {
    if (stopping && !process.exitCode) return;
    stop();
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`[studio] ${error.message}`);
    process.exitCode = 1;
  });
