import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createEngine } from "./engine.js";
import { createImageModels } from "./imageModels.js";
import { createMcp } from "./mcp.js";
import { inWorkspace, resolvePath } from "./files.js";
import { createTools } from "./tools.js";
import { createPageReader, search } from "./web.js";

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

// Connector sign-ins ({ tokens, client }) are kept in config.json, encrypted with the macOS keychain via safeStorage.
// oauth-clients.json (not in git) holds the OAuth apps Photon signs in with, e.g. { "github": { "client_id", "client_secret" } }.
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};
const connectorStore = {
  get: (id) => {
    const b64 = readConfig().connectors?.[id];
    return b64 ? JSON.parse(safeStorage.decryptString(Buffer.from(b64, "base64"))) : undefined;
  },
  set: (id, data) => {
    const { [id]: _, ...rest } = readConfig().connectors ?? {};
    // connectorTokens held personal access tokens before OAuth; drop them
    writeConfig({ connectorTokens: undefined, connectors: data ? { ...rest, [id]: safeStorage.encryptString(JSON.stringify(data)).toString("base64") } : rest });
  },
};
const mcp = createMcp({
  onChange: broadcast("connectors"),
  store: connectorStore,
  clients: readJson(path.join(import.meta.dirname, "oauth-clients.json")) ?? {},
  openUrl: (url) => shell.openExternal(url),
  onSignedIn: () => (app.focus({ steal: true }), BrowserWindow.getAllWindows()[0]?.show()),
});

// The SearXNG instance web_search asks, e.g. http://127.0.0.1:8888
const searchUrl = () => readConfig().searchUrl;
let readPage; // made on first use: sessions need the app to be ready
const workspace = () => path.join(app.getPath("userData"), "workspace");
const builtins = createTools({
  workspace,
  web: {
    canSearch: () => !!searchUrl(),
    search: (query, signal) => search(query, searchUrl(), { signal }),
    read: (url, opts) => (readPage ??= createPageReader({ BrowserWindow, session }))(url, opts),
  },
});
// Tool calls in progress, by tool call id, so Stop can cancel them
const running = new Map();

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
  return { modelsDir: dir, freeBytes: bavail * bsize, usedBytes: dirSize(dir), totalMem: os.totalmem(), workspaceDir: workspace() };
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
ipcMain.handle("connectors:connect", (_, id) => mcp.connect(id));
ipcMain.handle("connectors:disconnect", (_, id) => mcp.disconnect(id));
ipcMain.handle("tools:list", async () => [...(await builtins.tools()), ...mcp.tools()]);
ipcMain.handle("tools:call", async (_, name, args, id) => {
  const ctrl = new AbortController();
  running.set(id, ctrl);
  try {
    args = args && typeof args === "object" ? args : {};
    return await (builtins.has(name) ? builtins.call(name, args, ctrl.signal) : mcp.call(String(name), args, ctrl.signal));
  } finally {
    running.delete(id);
  }
});
ipcMain.handle("tools:cancel", (_, id) => running.get(id)?.abort());
ipcMain.handle("workspace:contains", (_, p) => typeof p === "string" && !!p.trim() && inWorkspace(resolvePath(p.trim(), workspace()), workspace()));
ipcMain.handle("workspace:reveal", () => (fs.mkdirSync(workspace(), { recursive: true }), shell.openPath(workspace())));
ipcMain.handle("search-url:get", () => searchUrl() ?? "");
ipcMain.handle("search-url:set", (_, url) => {
  url = typeof url === "string" ? url.trim().replace(/\/+$/, "") : "";
  if (url && !/^https?:\/\/[^/]+/.test(url)) throw new Error("The SearXNG address must start with http:// or https://");
  writeConfig({ searchUrl: url || undefined });
});
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
  for (const { id } of mcp.list()) mcp.resume(id).catch(() => {});
  createWindow();
});
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("will-quit", () => (llm.stop(), sd.stop()));
