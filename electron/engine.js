import { app } from "electron";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const resource = (p) => (app.isPackaged ? path.join(process.resourcesPath, p) : path.join(import.meta.dirname, "../resources", p));

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer().once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

// One local server process: free port, fresh API key, health check, restart on demand.
// launch(port, apiKey) returns the command-line args and extra env for this server.
// ponytail: if Electron is force-killed a server can outlive it; add a PID file and reap on next launch if that shows up
export function createEngine({ name, bin, health, fetchScript }) {
  const exe = resource(bin);
  let proc = null;
  let state = { status: "starting" };

  function stop() {
    const child = proc;
    proc = null;
    child?.kill();
  }

  async function start(dir, launch, onChange) {
    stop();
    const set = (s) => onChange((state = s));
    set({ status: "starting" });

    if (!fs.existsSync(exe)) return set({ status: "error", error: `${name} not found. Run \`node scripts/${fetchScript}\`.` });
    fs.mkdirSync(dir, { recursive: true });

    const port = await freePort();
    const apiKey = randomBytes(24).toString("hex");
    const url = `http://127.0.0.1:${port}`;
    const { args, env = {} } = launch(port, apiKey);
    const log = fs.openSync(path.join(app.getPath("userData"), `${name}.log`), "w");
    const child = (proc = spawn(exe, args, { env: { ...process.env, ...env }, stdio: ["ignore", log, log] }));

    child.on("exit", (code) => {
      if (proc === child) (proc = null), set({ status: "error", error: `${name} exited (code ${code}). See ${name}.log in the app data folder.` });
    });

    const headers = { Authorization: `Bearer ${apiKey}` };
    for (let i = 0; i < 120 && proc === child; i++) {
      const ok = await fetch(url + health, { headers }).then((r) => r.ok, () => false);
      if (ok) return set({ status: "ready", url, apiKey });
      await new Promise((r) => setTimeout(r, 250));
    }
    if (proc === child) set({ status: "error", error: `${name} did not become healthy in 30s.` });
  }

  return { state: () => state, start, stop };
}
