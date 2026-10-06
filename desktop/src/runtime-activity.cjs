const fs = require("node:fs");
const path = require("node:path");

// Observe real writes while uv prepares wheels. Its non-terminal output has no
// continuous download percentage; these events must never be presented as one.
function watchRuntimeActivity(directories, onActivity, delay = 1000, onError = () => {}) {
  const watchers = [];
  let timer = null;
  let latest = null;
  let closed = false;
  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
    watchers.push(
      fs
        .watch(directory, { recursive: true }, (_event, filename) => {
          if (closed || !filename) return;
          const relative = filename.toString();
          if ([".lock", ".gitignore", "CACHEDIR.TAG"].includes(path.basename(relative))) return;
          try {
            if (!fs.statSync(path.join(directory, relative)).isFile()) return;
          } catch {
            return;
          }
          const lower = relative.toLowerCase();
          const component = /torch|functorch/.test(lower)
            ? "PyTorch"
            : /cpython|python/.test(lower)
              ? "Python"
              : "runtime dependencies";
          latest = {
            component,
            file: path.basename(relative).slice(0, 80),
            updatedAt: new Date().toISOString(),
          };
          if (!timer)
            timer = setTimeout(() => {
              timer = null;
              if (!closed && latest) onActivity(latest);
            }, delay);
        })
        .on("error", onError)
    );
  }
  return () => {
    closed = true;
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}
module.exports = { watchRuntimeActivity };
