import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { engineState, startEngine, stopEngine } from "./engine.js";

const configPath = () => path.join(app.getPath("userData"), "config.json");
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
};
const writeConfig = (patch) => fs.writeFileSync(configPath(), JSON.stringify({ ...readConfig(), ...patch }, null, 2));
const modelsDir = () => readConfig().modelsDir ?? path.join(app.getPath("userData"), "models");

const broadcast = (s) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("engine", s));
const restart = () => startEngine(modelsDir(), broadcast);
const openExternal = (url) => /^https?:/.test(url) && shell.openExternal(url);

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true }))
    if (e.isFile()) total += fs.statSync(path.join(e.parentPath, e.name)).size;
  return total;
}

ipcMain.handle("engine:get", engineState);
ipcMain.handle("engine:restart", restart);
ipcMain.handle("info", async () => {
  const dir = modelsDir();
  fs.mkdirSync(dir, { recursive: true });
  const { bavail, bsize } = await fs.promises.statfs(dir);
  return { modelsDir: dir, freeBytes: bavail * bsize, usedBytes: dirSize(dir), totalMem: os.totalmem() };
});
ipcMain.handle("models:choose-dir", async (e) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: "Choose models folder",
    defaultPath: modelsDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled) return false;
  writeConfig({ modelsDir: filePaths[0] });
  restart();
  return true;
});
ipcMain.handle("models:reveal", () => shell.openPath(modelsDir()));

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 480,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: { preload: path.join(import.meta.dirname, "preload.cjs") },
  });

  win.webContents.setWindowOpenHandler(({ url }) => (openExternal(url), { action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) (e.preventDefault(), openExternal(url));
  });

  if (process.env.DEV_URL) win.loadURL(process.env.DEV_URL);
  else win.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  restart();
  createWindow();
});
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("will-quit", stopEngine);
