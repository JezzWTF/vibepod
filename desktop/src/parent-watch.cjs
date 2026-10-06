// Preloaded into the Studio's Node process (`node --require parent-watch.cjs server.js`).
// If the desktop that started it disappears, including by crashing, this process exits too
// instead of being left running with its port and memory.
const parent = Number(process.env.VIBEPOD_PARENT_PID);
const every = Number(process.env.VIBEPOD_PARENT_POLL_MS) || 2000;

if (parent > 0) {
  const timer = setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch (error) {
      if (error.code === "ESRCH") process.exit(0);
    }
  }, every);
  timer.unref();
}
