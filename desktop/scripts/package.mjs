import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = createHash("sha256").update(root.toLowerCase()).digest("hex").slice(0, 12);
const output = path.resolve(
  process.env.VIBEPOD_DESKTOP_OUTPUT ||
    path.join(process.env.LOCALAPPDATA, "VibePod/desktop-builds", key)
);
fs.mkdirSync(output, { recursive: true });
const storage = fs.statfsSync(output);
if (Number(storage.bsize) * Number(storage.bavail) < 2 * 2 ** 30)
  throw new Error(
    "At least 2 GB of free build space is required. Set VIBEPOD_DESKTOP_OUTPUT to a larger drive."
  );
const cli = require.resolve("electron-builder/out/cli/cli.js");
const result = spawnSync(
  process.execPath,
  [
    cli,
    "--win",
    ...(process.argv.includes("--dir") ? ["--dir"] : ["nsis"]),
    "--x64",
    "--config.directories.output",
    output,
  ],
  { cwd: root, stdio: "inherit", windowsHide: true }
);
console.log(`Desktop build output: ${output}`);
process.exitCode = result.status ?? 1;
