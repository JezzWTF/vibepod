const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("vibepod", {
  state: () => ipcRenderer.invoke("desktop:state"),
  version: () => ipcRenderer.invoke("desktop:version"),
  copyLog: () => ipcRenderer.invoke("desktop:copyLog"),
  chooseFolder: (key) => ipcRenderer.invoke("desktop:folder", key),
  install: (settings) => ipcRenderer.invoke("desktop:install", settings),
  pause: () => ipcRenderer.invoke("desktop:pause"),
  repair: () => ipcRenderer.invoke("desktop:repair"),
  retry: () => ipcRenderer.invoke("desktop:retry"),
  start: () => ipcRenderer.invoke("desktop:start"),
  driverHelp: () => ipcRenderer.invoke("desktop:driverHelp"),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop:changed", listener);
    return () => ipcRenderer.removeListener("desktop:changed", listener);
  },
});
