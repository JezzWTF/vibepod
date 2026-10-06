// Write the app's own failures to the desktop log, so a blank window or a silent exit leaves a
// record, and tell the user once where it is. After an uncaught exception Node considers the
// process unsafe to keep running, so the app is closed once the user has seen the message (or
// after `fatalWaitMs`, if the message never settles).
function installCrashLogging({
  app,
  proc = process,
  log,
  notify = () => {},
  exit = (code) => proc.exit(code),
  fatalWaitMs = 30000,
}) {
  let told = false;
  let exiting = false;
  const write = (line) => {
    try {
      log(line);
    } catch {
      // Losing the log must never become a second crash.
    }
  };
  const record = (line, tell = true) => {
    write(line);
    if (tell && !told) {
      told = true;
      notify(line);
    }
  };
  const fatal = (line) => {
    write(line);
    if (exiting) return;
    exiting = true;
    let timer;
    const finish = () => {
      clearTimeout(timer);
      exit(1);
    };
    timer = setTimeout(finish, fatalWaitMs);
    try {
      const shown = told ? undefined : ((told = true), notify(line));
      Promise.resolve(shown).then(finish, finish);
    } catch {
      finish();
    }
  };
  proc.on("uncaughtException", (error) => fatal(`Uncaught exception: ${error?.stack || error}`));
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
