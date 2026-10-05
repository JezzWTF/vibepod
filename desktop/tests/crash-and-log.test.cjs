const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { scrubLog } = require("../src/log-scrub.cjs");
const { installCrashLogging } = require("../src/crash-log.cjs");
const { DesktopController } = require("../src/controller.cjs");
function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-hardening-"));
}

test("logs are scrubbed of the home folder and user name in every spelling", () => {
  const home = "C:\\Users\\jane";
  const text = [
    "Starting C:\\Users\\jane\\AppData\\Roaming\\VibePod\\bin\\uv.exe",
    "cache c:/users/jane/AppData/x",
    JSON.stringify({ path: "C:\\Users\\jane\\x" }),
    "owner jane finished",
  ].join("\n");
  const scrubbed = scrubLog(text, { home, username: "jane" });
  assert.ok(!/jane/i.test(scrubbed), scrubbed);
  assert.match(scrubbed, /~\\AppData\\Roaming\\VibePod/);
  assert.match(scrubbed, /owner <user> finished/);
});

test("crash logging records failures, tells the user once, and survives a broken log", () => {
  const app = new EventEmitter();
  const proc = new EventEmitter();
  const lines = [],
    told = [];
  installCrashLogging({ app, proc, log: (l) => lines.push(l), notify: (l) => told.push(l) });
  proc.emit("uncaughtException", new Error("boom"));
  app.emit("render-process-gone", {}, {}, { reason: "crashed", exitCode: 9 });
  app.emit("child-process-gone", {}, { type: "GPU", reason: "killed", exitCode: 1 });
  proc.emit("unhandledRejection", new Error("late"));
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Uncaught exception: Error: boom/);
  assert.match(lines[1], /Window process gone: crashed \(exit 9\)/);
  assert.match(lines[2], /GPU process gone: killed/);
  assert.equal(told.length, 1);
  const broken = new EventEmitter();
  installCrashLogging({
    app: new EventEmitter(),
    proc: broken,
    log() {
      throw new Error("disk full");
    },
  });
  assert.doesNotThrow(() => broken.emit("uncaughtException", new Error("x")));
});

test("the copied log comes from the desktop log with private paths removed", () => {
  const root = temp();
  const resources = path.join(root, "resources");
  fs.mkdirSync(path.join(resources, "server"), { recursive: true });
  try {
    const controller = new DesktopController({ root, resources });
    fs.writeFileSync(
      path.join(root, "logs/desktop.log"),
      `first\nopened ${os.homedir()}\\Library\nlast\n`
    );
    const text = controller.scrubbedLog();
    assert.ok(!text.includes(os.homedir()), text);
    assert.match(text, /opened ~/);
    assert.match(controller.scrubbedLog(1), /^$|last/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
