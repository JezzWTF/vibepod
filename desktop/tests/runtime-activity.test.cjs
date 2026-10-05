const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { watchRuntimeActivity } = require("../src/runtime-activity.cjs");

test("uv temporary wheel writes publish real activity and watcher stops cleanly", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-activity-"));
  let stop;
  try {
    let notify;
    const event = new Promise((resolve) => {
      notify = resolve;
    });
    const changes = [];
    stop = watchRuntimeActivity(
      [root],
      (activity) => {
        changes.push(activity);
        notify(activity);
      },
      20
    );
    const wheel = path.join(root, ".tmp-wheel", "torch", "lib");
    fs.mkdirSync(wheel, { recursive: true });
    fs.writeFileSync(path.join(wheel, "torch_cuda.dll"), "actual prepared bytes");
    let deadline;
    const activity = await Promise.race([
      event,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("No runtime activity event")), 3000);
      }),
    ]).finally(() => clearTimeout(deadline));
    assert.equal(activity.component, "PyTorch");
    assert.equal(activity.file, "torch_cuda.dll");
    assert.ok(activity.updatedAt);
    stop();
    const count = changes.length;
    fs.appendFileSync(path.join(wheel, "torch_cuda.dll"), "more bytes");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(changes.length, count);
  } finally {
    stop?.();
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith("vibepod-activity-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
