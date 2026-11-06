import { app } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const bin = app.isPackaged
  ? path.join(process.resourcesPath, "llama", "llama-server")
  : path.join(import.meta.dirname, "../resources/llama/llama-server");

let proc = null;
let state = { status: "starting" };

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer().once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export const engineState = () => state;

// ponytail: if Electron is force-killed the router can outlive it; add a PID file and reap on next launch if that shows up
export async function startEngine(modelsDir, onChange) {
  stopEngine();
  const set = (s) => onChange((state = s));
  set({ status: "starting" });

  if (!fs.existsSync(bin)) return set({ status: "error", error: "llama-server not found. Run `node scripts/fetch-llama.js`." });
  fs.mkdirSync(modelsDir, { recursive: true });

  const port = await freePort();
  const apiKey = randomBytes(24).toString("hex");
  const url = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(app.getPath("userData"), "llama-server.log"), "w");
  const args = ["--host", "127.0.0.1", "--port", String(port), "--api-key", apiKey, "--models-max", "1", "--sleep-idle-seconds", "600"];
  const child = (proc = spawn(bin, args, { env: { ...process.env, LLAMA_CACHE: modelsDir }, stdio: ["ignore", log, log] }));

  child.on("exit", (code) => {
    if (proc === child) (proc = null), set({ status: "error", error: `llama-server exited (code ${code}). See llama-server.log in the app data folder.` });
  });

  for (let i = 0; i < 120 && proc === child; i++) {
    const ok = await fetch(`${url}/health`).then((r) => r.ok, () => false);
    if (ok) return set({ status: "ready", url, apiKey });
    await new Promise((r) => setTimeout(r, 250));
  }
  if (proc === child) set({ status: "error", error: "llama-server did not become healthy in 30s." });
}

export function stopEngine() {
  const child = proc;
  proc = null;
  child?.kill();
}
