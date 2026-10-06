const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { renameWithRetry } = require("../src/fs-retry.cjs");
function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-hardening-"));
}

test("a transient rename failure is retried on Windows with growing waits", () => {
  const waits = [];
  let calls = 0;
  const rename = () => {
    if (++calls < 4) throw Object.assign(new Error("locked"), { code: "EPERM" });
    return "done";
  };
  const result = renameWithRetry("a", "b", {
    platform: "win32",
    rename,
    sleep: (ms) => waits.push(ms),
  });
  assert.equal(result, "done");
  assert.deepEqual(waits, [25, 50, 100]);
});

test("rename errors that are not transient, or any error off Windows, are thrown at once", () => {
  const fail = (code) => () => {
    throw Object.assign(new Error(code), { code });
  };
  assert.throws(
    () => renameWithRetry("a", "b", { platform: "win32", rename: fail("ENOENT"), sleep() {} }),
    /ENOENT/
  );
  let calls = 0;
  assert.throws(() =>
    renameWithRetry("a", "b", {
      platform: "linux",
      rename: () => {
        calls++;
        fail("EPERM")();
      },
      sleep() {},
    })
  );
  assert.equal(calls, 1);
});

test("a rename that keeps failing gives up after eight tries and reports the last error", () => {
  let calls = 0;
  assert.throws(
    () =>
      renameWithRetry("a", "b", {
        platform: "win32",
        rename: () => {
          calls++;
          throw Object.assign(new Error("still locked"), { code: "EBUSY" });
        },
        sleep() {},
      }),
    /still locked/
  );
  assert.equal(calls, 8);
});
