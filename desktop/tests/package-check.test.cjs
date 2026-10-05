const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { checkPackage, REQUIRED } = require("../scripts/check-package.cjs");
function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-hardening-"));
}

test("the package check reports what a build is missing", () => {
  const output = temp();
  try {
    assert.ok(checkPackage(output, "0.1.0").length > REQUIRED.length);
    const unpacked = path.join(output, "win-unpacked");
    const runtime = path.join(unpacked, "resources/runtime");
    fs.mkdirSync(path.join(unpacked, "resources"), { recursive: true });
    fs.writeFileSync(path.join(unpacked, "VibePod.exe"), "x");
    fs.writeFileSync(path.join(unpacked, "resources/app.asar"), "x");
    for (const [file, minimum] of REQUIRED) {
      fs.mkdirSync(path.dirname(path.join(runtime, file)), { recursive: true });
      fs.writeFileSync(path.join(runtime, file), Buffer.alloc(Math.max(minimum, 1)));
    }
    assert.deepEqual(checkPackage(output, "0.1.0", { installer: false }), []);
    fs.writeFileSync(path.join(runtime, "bin/uv.exe"), "shim");
    assert.deepEqual(checkPackage(output, "0.1.0", { installer: false }), [
      "runtime/bin/uv.exe is only 4 bytes",
    ]);
    assert.match(checkPackage(output, "0.1.0").join(), /VibePod Setup 0\.1\.0\.exe was not built/);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
