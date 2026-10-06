const fs = require("node:fs");

// Antivirus scanners and indexers briefly hold new files on Windows, so a rename can fail with
// one of these codes and succeed a moment later. Anywhere else a failure is real.
const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);
const ATTEMPTS = 8;
const FIRST_WAIT_MS = 25;
const LONGEST_WAIT_MS = 400;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(
  from,
  to,
  { platform = process.platform, rename = fs.renameSync, sleep = sleepSync } = {}
) {
  const attempts = platform === "win32" ? ATTEMPTS : 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(from, to);
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.has(error.code)) throw error;
      sleep(Math.min(FIRST_WAIT_MS * 2 ** (attempt - 1), LONGEST_WAIT_MS));
    }
  }
}

module.exports = { renameWithRetry };
