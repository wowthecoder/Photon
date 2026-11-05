import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

const openExternal = (url) => /^https?:/.test(url) && shell.openExternal(url);

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 480,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 19 },
  });

  win.webContents.setWindowOpenHandler(({ url }) => (openExternal(url), { action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) (e.preventDefault(), openExternal(url));
  });

  if (process.env.DEV_URL) win.loadURL(process.env.DEV_URL);
  else win.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
}

app.whenReady().then(createWindow);
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
