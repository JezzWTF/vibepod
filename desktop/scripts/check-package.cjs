const fs = require("node:fs");
const path = require("node:path");

const MB = 1024 * 1024;
// Files the installed app cannot run without. A stale or partial `desktop:prepare` leaves some of
// these missing or as tiny shims, and the installer would still build without complaint.
const REQUIRED = [
  ["bin/uv.exe", MB],
  ["bin/ffmpeg.exe", MB],
  ["bin/ffprobe.exe", MB],
  ["web/server.js", 1],
  ["server/tts_server.py", 1],
  ["server/script_agent/api.py", 1],
  ["server/uv.lock", 1],
  ["helpers/dev.mjs", 1],
  ["helpers/parent-watch.cjs", 1],
];

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

// Returns a list of problems; empty means the build output looks complete.
function checkPackage(output, version, { installer = true } = {}) {
  const problems = [];
  const unpacked = path.join(output, "win-unpacked");
  if (sizeOf(path.join(unpacked, "VibePod.exe")) === null) problems.push("VibePod.exe is missing");
  if (sizeOf(path.join(unpacked, "resources/app.asar")) === null)
    problems.push("resources/app.asar is missing");
  const runtime = path.join(unpacked, "resources/runtime");
  for (const [file, minimum] of REQUIRED) {
    const size = sizeOf(path.join(runtime, file));
    if (size === null) problems.push(`runtime/${file} is missing`);
    else if (size < minimum) problems.push(`runtime/${file} is only ${size} bytes`);
  }
  if (installer) {
    const size = sizeOf(path.join(output, `VibePod Setup ${version}.exe`));
    if (size === null) problems.push(`VibePod Setup ${version}.exe was not built`);
    else if (size < 50 * MB) problems.push(`VibePod Setup ${version}.exe is only ${size} bytes`);
  }
  return problems;
}

module.exports = { checkPackage, REQUIRED };
