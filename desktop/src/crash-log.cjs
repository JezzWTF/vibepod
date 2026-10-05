// Write the app's own failures to the desktop log, so a blank window or a silent exit leaves a
// record, and tell the user once where it is.
function installCrashLogging({ app, proc = process, log, notify = () => {} }) {
  let told = false;
  const record = (line, tell = true) => {
    try {
      log(line);
    } catch {
      // Losing the log must never become a second crash.
    }
    if (tell && !told) {
      told = true;
      notify(line);
    }
  };
  proc.on("uncaughtException", (error) => record(`Uncaught exception: ${error?.stack || error}`));
  proc.on("unhandledRejection", (reason) =>
    record(`Unhandled rejection: ${reason?.stack || reason}`, false)
  );
  app.on("render-process-gone", (_event, _contents, details) =>
    record(`Window process gone: ${details.reason} (exit ${details.exitCode})`)
  );
  app.on("child-process-gone", (_event, details) =>
    record(`${details.type} process gone: ${details.reason} (exit ${details.exitCode})`, false)
  );
}

module.exports = { installCrashLogging };
