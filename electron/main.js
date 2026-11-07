import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createEngine } from "./engine.js";
import { createImageModels } from "./imageModels.js";
import { createMcp } from "./mcp.js";

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

const diffusionDir = () => path.join(modelsDir(), "diffusion");

const llm = createEngine({ name: "llama-server", bin: "llama/llama-server", health: "/health", fetchScript: "fetch-llama.js" });
const sd = createEngine({ name: "sd-server", bin: "sd/sd-server", health: "/sdcpp/v1/models/status", fetchScript: "fetch-sd.js" });

const broadcast = (channel) => (s) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, s));
const restartLlm = () =>
  llm.start(modelsDir(), (port, apiKey) => ({
    args: ["--host", "127.0.0.1", "--port", String(port), "--api-key", apiKey, "--models-max", "1", "--sleep-idle-seconds", "600"],
    env: { LLAMA_CACHE: modelsDir() },
  }), broadcast("engine"));
const restartSd = () =>
  sd.start(diffusionDir(), (port, apiKey) => ({
    args: ["--listen-ip", "127.0.0.1", "--listen-port", String(port), "--model-dir", diffusionDir(), "--diffusion-fa"],
    env: { SD_API_KEY: apiKey },
  }), broadcast("diffusion"));
const restart = () => (restartLlm(), restartSd());

const imageModels = createImageModels(diffusionDir, broadcast("image-models"));

// Connector tokens are kept in config.json, encrypted with the macOS keychain via safeStorage
const mcp = createMcp(broadcast("connectors"));
const savedTokens = () => readConfig().connectorTokens ?? {};
const saveToken = (id, token) => {
  const { [id]: _, ...rest } = savedTokens();
  writeConfig({ connectorTokens: token ? { ...rest, [id]: safeStorage.encryptString(token).toString("base64") } : rest });
};
const connectSaved = () => {
  for (const [id, b64] of Object.entries(savedTokens())) mcp.connect(id, safeStorage.decryptString(Buffer.from(b64, "base64"))).catch(() => {});
};

// Generated images live as PNGs in the app data folder and are served to the UI as photon-image://local/<id>.png
const imagesDir = () => path.join(app.getPath("userData"), "images");
function imageFile(id) {
  if (typeof id !== "string" || !/^[\w-]+$/.test(id)) throw new Error("Invalid image id");
  return path.join(imagesDir(), `${id}.png`);
}
// Chat attachments (images as PNG, audio as MP3/WAV/FLAC) are files too, served as photon-image://attachment/<id>.<ext>
const attachmentsDir = () => path.join(app.getPath("userData"), "attachments");
function attachmentFile(name) {
  if (typeof name !== "string" || !/^[\w-]+\.(png|mp3|wav|flac)$/.test(name)) throw new Error("Invalid attachment");
  return path.join(attachmentsDir(), name);
}
// stream: lets <audio> seek in attachments
protocol.registerSchemesAsPrivileged([{ scheme: "photon-image", privileges: { standard: true, secure: true, stream: true } }]);
const openExternal = (url) => /^https?:/.test(url) && shell.openExternal(url);

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true }))
    if (e.isFile()) total += fs.statSync(path.join(e.parentPath, e.name)).size;
  return total;
}

function pruneModels(repo) {
  const dir = modelsDir();
  const names = repo ? [`models--${repo.replace("/", "--")}`] : fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const name of names.filter((n) => n.startsWith("models--"))) {
    const blobs = path.join(dir, name, "blobs");
    if (fs.existsSync(blobs) && fs.readdirSync(blobs).length) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    fs.rmSync(path.join(dir, ".locks", name), { recursive: true, force: true });
  }
}

ipcMain.handle("engine:get", llm.state);
ipcMain.handle("diffusion:get", sd.state);
ipcMain.handle("models:prune", (_, repo) => {
  if (typeof repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid repo");
  pruneModels(repo);
});
ipcMain.handle("engine:restart", restartLlm);
ipcMain.handle("diffusion:restart", restartSd);
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
ipcMain.handle("image-models:list", imageModels.list);
ipcMain.handle("image-models:download", (_, id) => imageModels.start(id));
ipcMain.handle("image-models:pause", (_, id) => imageModels.pause(id));
ipcMain.handle("image-models:delete", (_, id) => imageModels.remove(id));
ipcMain.handle("connectors:list", mcp.list);
ipcMain.handle("connectors:connect", async (_, id, token) => {
  if (typeof token !== "string" || !token.trim()) throw new Error("Enter a token");
  if (await mcp.connect(id, token.trim())) saveToken(id, token.trim());
});
ipcMain.handle("connectors:disconnect", (_, id) => (mcp.disconnect(id), saveToken(id, null)));
ipcMain.handle("mcp:tools", mcp.tools);
ipcMain.handle("mcp:call", (_, name, args) => mcp.call(String(name), args && typeof args === "object" ? args : {}));
ipcMain.handle("images:save", (_, id, b64) => {
  const file = imageFile(id);
  fs.mkdirSync(imagesDir(), { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
});
ipcMain.handle("images:read", (_, id) => fs.readFileSync(imageFile(id)).toString("base64"));
ipcMain.handle("images:delete", (_, id) => fs.rmSync(imageFile(id), { force: true }));
ipcMain.handle("images:reveal", (_, id) => shell.showItemInFolder(imageFile(id)));
ipcMain.handle("attachments:save", (_, name, b64) => {
  const file = attachmentFile(name);
  fs.mkdirSync(attachmentsDir(), { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
});
ipcMain.handle("attachments:read", (_, name) => fs.readFileSync(attachmentFile(name)).toString("base64"));
ipcMain.handle("attachments:delete", (_, names) => {
  for (const name of Array.isArray(names) ? names : []) fs.rmSync(attachmentFile(name), { force: true });
});

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
  protocol.handle("photon-image", (req) => {
    const url = new URL(req.url);
    const file = url.hostname === "attachment" ? attachmentFile(path.basename(url.pathname)) : imageFile(path.basename(url.pathname, ".png"));
    // pass Range through so <audio> can seek
    return net.fetch(pathToFileURL(file).href, { headers: req.headers });
  });
  pruneModels();
  restart();
  connectSaved();
  createWindow();
});
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("will-quit", () => (llm.stop(), sd.stop()));
