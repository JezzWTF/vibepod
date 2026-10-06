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

test("crash logging records failures, tells the user once, and survives a broken log", async () => {
  const app = new EventEmitter();
  const proc = new EventEmitter();
  const lines = [],
    told = [],
    exits = [];
  installCrashLogging({
    app,
    proc,
    log: (l) => lines.push(l),
    notify: (l) => told.push(l),
    exit: (code) => exits.push(code),
  });
  app.emit("render-process-gone", {}, {}, { reason: "crashed", exitCode: 9 });
  app.emit("child-process-gone", {}, { type: "GPU", reason: "killed", exitCode: 1 });
  proc.emit("unhandledRejection", new Error("late"));
  assert.deepEqual(exits, [], "non-fatal failures keep the app running");
  proc.emit("uncaughtException", new Error("boom"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Window process gone: crashed \(exit 9\)/);
  assert.match(lines[1], /GPU process gone: killed/);
  assert.match(lines[3], /Uncaught exception: Error: boom/);
  assert.equal(told.length, 1);
  assert.deepEqual(exits, [1], "an uncaught exception ends the app even after the user was told");
  const broken = new EventEmitter();
  const brokenExits = [];
  installCrashLogging({
    app: new EventEmitter(),
    proc: broken,
    log() {
      throw new Error("disk full");
    },
    exit: (code) => brokenExits.push(code),
  });
  assert.doesNotThrow(() => broken.emit("uncaughtException", new Error("x")));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(brokenExits, [1]);
});

test("a fatal exception waits for the message to be dismissed, but not forever", async () => {
  const exits = [];
  const waiting = new EventEmitter();
  let dismiss;
  installCrashLogging({
    app: new EventEmitter(),
    proc: waiting,
    log() {},
    notify: () => new Promise((resolve) => (dismiss = resolve)),
    exit: (code) => exits.push(code),
  });
  waiting.emit("uncaughtException", new Error("a"));
  waiting.emit("uncaughtException", new Error("b"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(exits, [], "still showing the message");
  dismiss();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(exits, [1], "exits once, however many exceptions arrive");

  const stuck = new EventEmitter();
  const stuckExits = [];
  installCrashLogging({
    app: new EventEmitter(),
    proc: stuck,
    log() {},
    notify: () => new Promise(() => {}),
    exit: (code) => stuckExits.push(code),
    fatalWaitMs: 40,
  });
  stuck.emit("uncaughtException", new Error("c"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(stuckExits, [1], "a message that never settles cannot keep the app alive");
});

test("a user name with accents is scrubbed on Unicode word boundaries", () => {
  const scrubbed = scrubLog("owner José finished, Josés kept, JOSÉ.", {
    home: "",
    username: "José",
  });
  assert.equal(scrubbed, "owner <user> finished, Josés kept, <user>.");
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
