const $ = (id) => document.getElementById(id);
const api = window.vibepod;
let current;
let previousView;
function bytes(value) {
  return Number.isFinite(value) ? `${(value / 2 ** 30).toFixed(1)} GB` : "Checking size";
}
function notice(error) {
  $("launch-note").textContent = error.message;
  $("download-note").textContent = error.message;
}
async function action(callback) {
  try {
    await callback();
  } catch (error) {
    notice(error);
  }
}
function render(state) {
  current = state;
  $("launch-note").textContent = "";
  const view =
    state.view === "checking" ? "install" : state.view === "studio" ? "ready" : state.view;
  document.querySelectorAll(".view").forEach((el) => (el.hidden = el.id !== view));
  if (view !== previousView) {
    document.querySelector(`#${view} h1`)?.focus({ preventScroll: true });
    previousView = view;
  }
  const active = { setup: 1, install: 2, ready: 3, repair: 1 }[view];
  document.querySelector(".steps").innerHTML = (
    view === "repair"
      ? ["Check installation", "Repair engine", "Verify", "Open Studio"]
      : ["Check device", "Choose storage", "Install", "Open Studio"]
  )
    .map(
      (label, i) =>
        `<li class="${i < active ? "done" : i === active ? "current" : ""}"><span class="step-no">${i < active ? "✓" : i + 1}</span>${label}</li>`
    )
    .join("");
  $("chrome-state").textContent = state.stage;
  $("footer-state").textContent =
    view === "repair"
      ? "Recovery"
      : view === "ready"
        ? "Installation verified"
        : "Local installation";
  $("models-path").textContent = state.settings.models;
  $("library-path").textContent = state.settings.library;
  $("ready-path").textContent = state.settings.library;
  $("ready-design").hidden = !state.settings.design;
  $("design-model").checked = state.settings.design;
  $("design-model").disabled = state.designInstalled || state.busy;
  document
    .querySelectorAll("[data-location]")
    .forEach((button) => (button.disabled = state.configured || state.busy || state.browserReview));
  const values = document.querySelectorAll(".system strong");
  values[0].textContent = state.device
    ? `${state.device.name} · ${state.device.vram.toFixed(0)} GB`
    : "Not available";
  values[1].textContent = state.device ? state.device.driver : "Needs attention";
  values[2].textContent = Number.isFinite(state.available) ? bytes(state.available) : "Unavailable";
  $("begin").textContent = state.configured
    ? state.settings.design && !state.designInstalled
      ? "Install voice design"
      : "Open Studio"
    : "Set up VibePod";
  $("begin").disabled = state.busy;
  $("install").querySelector("h1").textContent = state.repair
    ? "Restoring your Studio."
    : state.component === "startup"
      ? "Opening your Studio."
      : state.view === "checking"
        ? "Checking your installation."
        : "Your Studio is taking shape.";
  $("install").querySelector(".intro").textContent = state.stage;
  const jobs = $("install").querySelectorAll(".job");
  jobs[0].className =
    state.component === "engine" ? "job active" : state.engineVerified ? "job complete" : "job";
  jobs[0].querySelector(".mark").textContent = state.engineVerified ? "✓" : "01";
  jobs[0].querySelector(".job-head span:last-child").textContent =
    state.component === "engine" ? "Working" : state.engineVerified ? "Verified" : "Waiting";
  jobs[0].querySelector(".detail").textContent =
    state.component === "engine" && state.engineActivity
      ? `Preparing ${state.engineActivity.component} · ${state.engineActivity.file}`
      : "Managed by VibePod";
  $("base-job").className = state.component === "Base" ? "job active" : "job";
  $("design-job").className = state.component === "VoiceDesign" ? "job active" : "job";
  $("download-title").textContent = "Core voice model";
  $("base-state").textContent =
    state.component === "Base"
      ? state.paused
        ? "Paused"
        : state.download?.phase === "verifying"
          ? "Verifying"
          : "Downloading"
      : state.completed?.includes("Base")
        ? "Verified"
        : "Waiting";
  $("design-state").textContent = !state.settings.design
    ? "Not selected"
    : state.component === "VoiceDesign"
      ? state.paused
        ? "Paused"
        : state.download?.phase === "verifying"
          ? "Verifying"
          : "Downloading"
      : state.completed?.includes("VoiceDesign")
        ? "Verified"
        : "Waiting";
  $("download-path").textContent = state.settings.models;
  const progress = $("download-bar").parentElement;
  const stats = document.querySelector(".download-stats");
  $(state.component === "VoiceDesign" ? "design-job" : "base-job").append(progress, stats);
  const downloading = ["Base", "VoiceDesign"].includes(state.component);
  progress.hidden = !downloading;
  stats.hidden = !downloading;
  $("design-detail").textContent = "Create voices from a description";
  const total = state.download?.total || 0;
  const downloaded = state.download?.downloaded || 0;
  const ratio = total ? Math.min(1, downloaded / total) : 0;
  $("download-bar").style.transform = `scaleX(${ratio})`;
  if (total) progress.setAttribute("aria-valuenow", Math.round(ratio * 100));
  else progress.removeAttribute("aria-valuenow");
  $("download-bytes").textContent = total
    ? `${bytes(downloaded)} / ${bytes(total)}`
    : "Reading model information";
  $("download-speed").textContent =
    state.download?.phase === "verifying" ? "Verifying file integrity" : state.download?.file || "";
  $("final-state").textContent = state.stage === "Verifying installation" ? "Verifying" : "Waiting";
  $("pause").hidden = !downloading;
  $("pause").textContent = state.paused ? "Resume download" : "Pause download";
  $("download-note").textContent = state.paused
    ? "Your download progress is saved. Resume when you’re ready."
    : "";
  $("open-studio").disabled = state.busy;
  if (state.error) {
    const error = state.error;
    const driver = error.kind === "driver";
    const download = error.kind === "download";
    const application = error.kind === "application";
    $("failure-title").textContent = driver
      ? "The graphics device needs attention."
      : download
        ? "The model download was interrupted."
        : application
          ? "The application needs attention."
          : "The engine needs attention.";
    $("failure-description").textContent = error.message;
    $("repair-button").textContent = driver
      ? "NVIDIA driver guidance"
      : download
        ? "Resume model setup"
        : application
          ? "View application log"
          : "Repair voice engine";
    $("runtime-check").replaceChildren(
      document.createTextNode(
        driver ? "Graphics device" : application ? "Studio application" : "Voice engine"
      )
    );
    const status = document.createElement("span");
    status.className = "warn";
    status.textContent = driver ? "Check required" : "Needs attention";
    $("runtime-check").append(status);
    $("repair").querySelector(".intro").textContent = state.libraryAvailable
      ? "The Studio couldn’t start. Your episodes, voices and finished audio are still in place."
      : "The Studio couldn’t start. Complete setup to create your local library.";
    const checks = $("repair").querySelectorAll(".checks li span");
    checks[0].textContent = state.libraryAvailable ? "Available" : "Not created yet";
    checks[1].textContent = state.modelsAvailable
      ? "Present · retained during repair"
      : "Setup needed";
    $("diagnostics").textContent = `${error.kind.toUpperCase()}\n${error.message}`;
    $("repair-safe").textContent = driver
      ? "Check your graphics driver before retrying. Your library and model files will be retained."
      : download
        ? "Completed model files and partial downloads are retained. Your library is unchanged."
        : application
          ? "Reinstall the VibePod application if retrying fails. Keep your existing library and model folders."
          : "Repair restores the voice engine. It keeps your episodes, saved voices and models.";
  }
  $("repair-progress").hidden = true;
}
if (api) {
  api.onState(render);
  api.state().then(render).catch(notice);
  api.version().then((version) => ($("footer-version").textContent = version));
  document
    .querySelectorAll("[data-location]")
    .forEach(
      (button) => (button.onclick = () => action(() => api.chooseFolder(button.dataset.location)))
    );
  $("design-model").onchange = () => {
    current.settings.design = $("design-model").checked;
    render(current);
  };
  $("begin").onclick = () =>
    action(() =>
      current.configured && (!current.settings.design || current.designInstalled)
        ? api.start()
        : api.install(current.settings)
    );
  $("pause").onclick = () =>
    action(() => (current.paused ? api.install(current.settings) : api.pause()));
  $("repair-button").onclick = () =>
    action(() =>
      current.error.kind === "application"
        ? $("show-logs").click()
        : current.error.kind === "driver"
          ? api.driverHelp()
          : api.repair()
    );
  $("retry").onclick = () => action(() => api.retry());
  $("open-studio").onclick = () => action(() => api.start());
  $("review-settings").onclick = () => render({ ...current, view: "setup" });
  for (const id of ["copy-log", "copy-log-dialog"])
    $(id).onclick = async () => {
      const button = $(id);
      const label = button.textContent;
      button.textContent = (await api.copyLog().catch(() => false)) ? "Copied" : "Not copied";
      setTimeout(() => (button.textContent = label), 1500);
    };
  $("show-logs").onclick = () => {
    $("full-log").textContent = current.logs.join("\n");
    $("log-dialog").showModal();
  };
} else {
  $("setup").querySelector(".intro").textContent =
    "Open the VibePod desktop application to install or repair its runtime.";
  document.querySelectorAll("button,input").forEach((el) => (el.disabled = true));
}
