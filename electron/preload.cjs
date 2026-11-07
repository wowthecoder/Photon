const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("photon", {
  engine: () => ipcRenderer.invoke("engine:get"),
  restartEngine: () => ipcRenderer.invoke("engine:restart"),
  onEngine: (cb) => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on("engine", listener);
    return () => ipcRenderer.off("engine", listener);
  },
  diffusion: () => ipcRenderer.invoke("diffusion:get"),
  restartDiffusion: () => ipcRenderer.invoke("diffusion:restart"),
  onDiffusion: (cb) => {
    const listener = (_, state) => cb(state);
    ipcRenderer.on("diffusion", listener);
    return () => ipcRenderer.off("diffusion", listener);
  },
  imageModels: () => ipcRenderer.invoke("image-models:list"),
  onImageModels: (cb) => {
    const listener = (_, list) => cb(list);
    ipcRenderer.on("image-models", listener);
    return () => ipcRenderer.off("image-models", listener);
  },
  downloadImageModel: (id) => ipcRenderer.invoke("image-models:download", id),
  pauseImageModel: (id) => ipcRenderer.invoke("image-models:pause", id),
  deleteImageModel: (id) => ipcRenderer.invoke("image-models:delete", id),
  saveImage: (id, b64) => ipcRenderer.invoke("images:save", id, b64),
  readImage: (id) => ipcRenderer.invoke("images:read", id),
  saveAttachment: (name, b64) => ipcRenderer.invoke("attachments:save", name, b64),
  readAttachment: (name) => ipcRenderer.invoke("attachments:read", name),
  deleteAttachments: (names) => ipcRenderer.invoke("attachments:delete", names),
  deleteImage: (id) => ipcRenderer.invoke("images:delete", id),
  revealImage: (id) => ipcRenderer.invoke("images:reveal", id),
  info: () => ipcRenderer.invoke("info"),
  chooseModelsDir: () => ipcRenderer.invoke("models:choose-dir"),
  revealModelsDir: () => ipcRenderer.invoke("models:reveal"),
  pruneModels: (repo) => ipcRenderer.invoke("models:prune", repo),
});
