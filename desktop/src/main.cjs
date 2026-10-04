const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { DesktopController } = require("./controller.cjs");
let window,
  controller,
  quitting = false,
  studioOrigin = null;
const ui = path.join(__dirname, "../ui/index.html");
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      app.setName("VibePod");
      const development = !app.isPackaged;
      const repository = path.resolve(__dirname, "../..");
      const resources = development
        ? path.join(__dirname, "../resources")
        : path.join(process.resourcesPath, "runtime");
      const root = path.join(app.getPath("userData"), development ? "development" : "installation");
      let devConfig = null;
      if (development && fs.existsSync(path.join(repository, ".vibepod/config.json")))
        devConfig = JSON.parse(
          fs
            .readFileSync(path.join(repository, ".vibepod/config.json"), "utf8")
            .replace(/^\uFEFF/, "")
        );
      window = new BrowserWindow({
        width: 1060,
        height: 870,
        minWidth: 800,
        minHeight: 720,
        backgroundColor: "#17191d",
        title: "VibePod",
        autoHideMenuBar: true,
        icon: path.join(__dirname, "../assets/icon.ico"),
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (
          url !== pathToFileURL(ui).href &&
          !(studioOrigin && new URL(url).origin === studioOrigin)
        )
          event.preventDefault();
      });
      controller = new DesktopController({
        root,
        resources,
        node: process.execPath,
        helpers: pathToFileURL(path.join(resources, "helpers/dev.mjs")).href,
        devConfig,
        onState: (state) => {
          if (!window || window.isDestroyed()) return;
          if (state.view === "repair" && studioOrigin) {
            studioOrigin = null;
            window.loadFile(ui);
          }
          window.webContents.send("desktop:changed", state);
        },
      });
      function handle(name, action) {
        ipcMain.handle(`desktop:${name}`, async (event, ...args) => {
          if (
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame.url !== pathToFileURL(ui).href
          )
            throw new Error("Desktop action is only available to the setup screen.");
          return action(...args);
        });
      }
      handle("state", () => controller.state);
      handle("folder", async (key) => {
        if (!["models", "library"].includes(key)) throw new Error("Unknown storage location.");
        if (controller.config || controller.state.busy)
          throw new Error("Storage choices are locked after installation.");
        const result = await dialog.showOpenDialog(window, {
          title: key === "models" ? "Voice model location" : "Episode & voice location",
          defaultPath: controller.state.settings[key],
          properties: ["openDirectory", "createDirectory"],
        });
        if (!result.canceled)
          await controller.configure({ ...controller.state.settings, [key]: result.filePaths[0] });
        return controller.state;
      });
      handle("install", (settings) => controller.install(settings));
      handle("pause", () => controller.pause());
      handle("repair", () =>
        controller.install(controller.state.settings, controller.state.error?.kind !== "download")
      );
      handle("retry", () => controller.check());
      handle("driverHelp", () => shell.openExternal("https://www.nvidia.com/en-us/drivers/"));
      handle("start", async () => {
        const url = await controller.start();
        studioOrigin = new URL(url).origin;
        await window.loadURL(url);
      });
      await window.loadFile(ui);
      if (!fs.existsSync(path.join(resources, "server/uv.lock"))) {
        controller.fail(
          new Error(
            "Desktop runtime resources are missing. Prepare the desktop build before launching."
          )
        );
        return;
      }
      await controller.check();
      if (process.argv.includes("--smoke-test")) {
        const loaded = await window.webContents.executeJavaScript(
          "window.vibepod.state().then(state => ({title: document.title, view: state.view}))"
        );
        console.log(
          JSON.stringify({
            event: "desktop-smoke",
            title: loaded.title,
            view: loaded.view,
            device: controller.state.device?.name,
          })
        );
        app.quit();
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    if (controller && !quitting) {
      event.preventDefault();
      quitting = true;
      controller.stop().finally(() => app.quit());
    }
  });
  app.on("window-all-closed", () => app.quit());
}
