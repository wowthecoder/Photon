const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("photon", {
  engine: () => ipcRenderer.invoke("engine:get"),
  restartEngine: () => ipcRenderer.invoke("engine:restart"),
  onEngine: (cb) => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on("engine", listener);
    return () => ipcRenderer.off("engine", listener);
  },
  info: () => ipcRenderer.invoke("info"),
  chooseModelsDir: () => ipcRenderer.invoke("models:choose-dir"),
  revealModelsDir: () => ipcRenderer.invoke("models:reveal"),
  pruneModels: (repo) => ipcRenderer.invoke("models:prune", repo),
});
