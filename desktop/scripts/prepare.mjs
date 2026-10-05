import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "desktop/resources");
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.error?.message || ""}`);
}
if (process.platform !== "win32") throw new Error("This build targets Windows x64.");
// tsconfig includes every distDir's generated types. Types left by an older checkout's dev server
// or check build (for example routes that no longer exist) would fail this build's type check.
for (const stale of [".next", ".next-check"])
  fs.rmSync(path.join(root, "web", stale, "types"), { recursive: true, force: true });
if (!process.argv.includes("--skip-web"))
  run("cmd.exe", ["/d", "/s", "/c", "pnpm --filter vibepod-web build"], {
    env: { ...process.env, VIBEPOD_DESKTOP_BUILD: "1" },
  });
fs.mkdirSync(destination, { recursive: true });
const standalone = path.join(root, "web/.next-desktop/standalone");
if (!fs.existsSync(standalone)) throw new Error("Build the desktop standalone frontend first.");
// Flatten traced packages once, rather than dereferencing pnpm aliases into
// duplicate Next/React copies with missing sibling dependencies.
const webDestination = path.join(destination, `web-stage-${randomUUID()}`);
fs.cpSync(standalone, webDestination, {
  recursive: true,
  filter: (source) => !path.relative(standalone, source).split(path.sep).includes("node_modules"),
});
const packages = new Map();
const store = path.join(standalone, "node_modules/.pnpm");
function collect(directory, scope = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    if (entry.name.startsWith("@") && !scope) {
      collect(source, entry.name + "/");
      continue;
    }
    if (entry.name === "node_modules" || !fs.existsSync(path.join(source, "package.json")))
      continue;
    const name = scope + entry.name;
    const version = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).version;
    if (packages.has(name) && packages.get(name).version !== version)
      throw new Error(`Conflicting traced package versions: ${name}`);
    if (!packages.has(name)) packages.set(name, { source, version });
  }
}
for (const entry of fs.readdirSync(store, { withFileTypes: true })) {
  const directory = path.join(store, entry.name, "node_modules");
  if (entry.isDirectory() && fs.existsSync(directory)) collect(directory);
}
for (const [name, { source }] of packages)
  fs.cpSync(source, path.join(webDestination, "node_modules", name), {
    recursive: true,
    filter: (file) => !path.relative(source, file).split(path.sep).includes("node_modules"),
  });
// Next monorepos can place their server inside a web/ directory.
const serverRoot = fs.existsSync(path.join(webDestination, "server.js"))
  ? webDestination
  : path.join(webDestination, "web");
fs.cpSync(
  path.join(root, "web/.next-desktop/static"),
  path.join(serverRoot, ".next-desktop/static"),
  { recursive: true, dereference: true }
);
if (fs.existsSync(path.join(root, "web/public")))
  fs.cpSync(path.join(root, "web/public"), path.join(serverRoot, "public"), {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}previews`),
  });
if (serverRoot !== webDestination)
  fs.writeFileSync(path.join(webDestination, "server.js"), 'require("./web/server.js");\n');
const previousWeb = path.join(destination, `web-previous-${randomUUID()}`);
const activeWeb = path.join(destination, "web");
// A running desktop can lock this directory on Windows. Fail without removing
// its files; only discard the previous generated tree after replacing it.
if (fs.existsSync(activeWeb)) fs.renameSync(activeWeb, previousWeb);
try {
  fs.renameSync(webDestination, activeWeb);
} catch (error) {
  if (fs.existsSync(previousWeb)) fs.renameSync(previousWeb, activeWeb);
  throw error;
}
if (
  path.dirname(previousWeb) !== destination ||
  !path.basename(previousWeb).startsWith("web-previous-")
)
  throw new Error("Unexpected generated cleanup path.");
fs.rmSync(previousWeb, { recursive: true, force: true });
fs.mkdirSync(path.join(destination, "server/spike"), { recursive: true });
for (const file of fs.readdirSync(path.join(root, "server")))
  if (file.endsWith(".py") || ["pyproject.toml", "uv.lock"].includes(file))
    fs.copyFileSync(path.join(root, "server", file), path.join(destination, "server", file));
fs.copyFileSync(
  path.join(root, "server/spike/download.py"),
  path.join(destination, "server/spike/download.py")
);
fs.mkdirSync(path.join(destination, "helpers"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts/dev.mjs"), path.join(destination, "helpers/dev.mjs"));
function tool(name, override) {
  if (override) return override;
  const result = spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true });
  const choices = result.stdout?.trim().split(/\r?\n/).filter(Boolean) || [];
  if (name.startsWith("ff")) {
    const actual = path.join(
      process.env.ProgramData || "C:\\ProgramData",
      "chocolatey/lib/ffmpeg/tools/ffmpeg/bin",
      name + ".exe"
    );
    if (fs.existsSync(actual)) return actual;
  }
  if (!choices.length)
    throw new Error(
      `Missing build tool: ${name}. It is bundled from this machine, not downloaded. Run ./setup.ps1 -InstallTools, or set VIBEPOD_${name.toUpperCase()}_BINARY to its real executable.`
    );
  return choices[0];
}
const binaries = {
  uv: tool("uv", process.env.VIBEPOD_UV_BINARY),
  ffmpeg: tool("ffmpeg", process.env.VIBEPOD_FFMPEG_BINARY),
  ffprobe: tool("ffprobe", process.env.VIBEPOD_FFPROBE_BINARY),
};
fs.mkdirSync(path.join(destination, "bin"), { recursive: true });
for (const [name, source] of Object.entries(binaries)) {
  if (fs.statSync(source).size < 1024 * 1024)
    throw new Error(
      `${name} appears to be a shim. Point VIBEPOD_${name.toUpperCase()}_BINARY at its real executable.`
    );
  fs.copyFileSync(source, path.join(destination, "bin", name + ".exe"));
  run(path.join(destination, "bin", name + ".exe"), [name === "uv" ? "--version" : "-version"]);
}
for (const file of fs.readdirSync(path.dirname(binaries.ffmpeg)))
  if (file.endsWith(".dll"))
    fs.copyFileSync(
      path.join(path.dirname(binaries.ffmpeg), file),
      path.join(destination, "bin", file)
    );
const licenseRoot = path.dirname(path.dirname(binaries.ffmpeg));
fs.mkdirSync(path.join(destination, "licenses"), { recursive: true });
fs.cpSync(path.join(root, "desktop/licenses"), path.join(destination, "licenses"), {
  recursive: true,
});
for (const file of fs.readdirSync(licenseRoot))
  if (/^(license|copying)/i.test(file) && fs.statSync(path.join(licenseRoot, file)).isFile())
    fs.copyFileSync(path.join(licenseRoot, file), path.join(destination, "licenses", file));
fs.writeFileSync(
  path.join(destination, "licenses/uv.txt"),
  "uv is distributed under the MIT and Apache-2.0 licenses.\nhttps://github.com/astral-sh/uv/blob/main/LICENSE-MIT\nhttps://github.com/astral-sh/uv/blob/main/LICENSE-APACHE\n"
);
console.log(`Desktop resources prepared: ${destination}`);
