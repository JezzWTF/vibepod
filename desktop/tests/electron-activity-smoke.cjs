// Run directly with Electron: a hidden, isolated renderer integration check.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const { DesktopController } = require("../src/controller.cjs");
const { watchRuntimeActivity } = require("../src/runtime-activity.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibepod-renderer-smoke-"));
app.setPath("userData", root);
let stop;
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(__dirname, "../src/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const controller = new DesktopController({
      root,
      resources: path.resolve(__dirname, "../resources"),
      onState: (state) => window.webContents.send("desktop:changed", state),
    });
    ipcMain.handle("desktop:state", () => controller.state);
    await window.loadFile(path.resolve(__dirname, "../ui/index.html"));
    controller.emit({
      view: "install",
      busy: true,
      component: "engine",
      stage: "Preparing Python and GPU packages",
    });
    const directory = path.join(root, "cache/.tmp-wheel/torch/lib");
    fs.mkdirSync(directory, { recursive: true });
    let notify;
    const observed = new Promise((resolve) => {
      notify = resolve;
    });
    stop = watchRuntimeActivity(
      [path.join(root, "cache")],
      (activity) => {
        controller.emit({ engineActivity: activity });
        notify();
      },
      20
    );
    fs.writeFileSync(path.join(directory, "torch_cuda.dll"), "actual file activity");
    let deadline;
    await Promise.race([
      observed,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("No filesystem activity")), 3000);
      }),
    ]).finally(() => clearTimeout(deadline));
    const detail = await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Renderer did not update'))},3000);
    const check=()=>{const detail=document.querySelector('#install .job .detail').textContent;if(detail.includes('torch_cuda.dll')){clearTimeout(timer);observer.disconnect();resolve(detail)}};
    const observer=new MutationObserver(check);observer.observe(document.body,{subtree:true,childList:true,characterData:true});check();
  })`);
    assert.equal(detail, "Preparing PyTorch · torch_cuda.dll");
    console.log(JSON.stringify({ event: "desktop-runtime-renderer", detail }));
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    stop?.();
    app.quit();
  });
