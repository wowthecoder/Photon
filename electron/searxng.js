import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { findRuntime as defaultFindRuntime, PULL_TIMEOUT, run } from "./tools.js";

// A SearXNG that Photon runs itself, for web_search when the user hasn't set an address of their own.
// It starts on the first search of a launch, with Docker or Apple's container, and is removed when Photon quits.
const IMAGE = "searxng/searxng:latest";
const NAME = "photon-searxng";
const START_TIMEOUT = 60_000;

// JSON is off in SearXNG's defaults; the limiter would block Photon's searches
const settings = () => `use_default_settings: true
server:
  secret_key: "${crypto.randomBytes(32).toString("hex")}"
  limiter: false
search:
  formats: [html, json]
`;

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer().once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

// dir() is the folder for its settings.yml, mounted at /etc/searxng.
export function createSearxng({ dir, findRuntime = defaultFindRuntime }) {
  let ready; // Promise<{ url } | { error }>, shared by searches that arrive while it starts
  let started; // the runtime it was started with, to remove it on quit

  async function start(signal) {
    const rt = await findRuntime();
    if (!rt) return { error: "web_search needs Docker or Apple's container, so Photon can run SearXNG, or the address of a SearXNG in Settings." };
    const conf = dir();
    fs.mkdirSync(conf, { recursive: true });
    const file = path.join(conf, "settings.yml");
    if (!fs.existsSync(file)) fs.writeFileSync(file, settings());
    const opts = { env: rt.env, signal };
    // setup starts Apple's container service; failures are fine when things are already set up
    for (const args of rt.setup) await run(rt.bin, args, opts);
    await run(rt.bin, ["image", "pull", IMAGE], { ...opts, timeout: PULL_TIMEOUT });
    await run(rt.bin, ["rm", "-f", NAME], opts); // left over if Photon didn't quit cleanly
    const port = await freePort();
    const out = await run(rt.bin, ["run", "-d", "--name", NAME, "-p", `127.0.0.1:${port}:8080`, "-v", `${conf}:/etc/searxng`, IMAGE], opts);
    if (!out.endsWith("[exit code 0]")) return { error: `Photon couldn't start SearXNG: ${out}` };
    started = rt;
    const url = `http://127.0.0.1:${port}`;
    for (const until = Date.now() + START_TIMEOUT; Date.now() < until && !signal?.aborted; ) {
      try {
        if ((await fetch(`${url}/healthz`, { signal })).ok) return { url };
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (signal?.aborted) return { error: "Stopped by the user." };
    // Apple's runtime forwards the port to the container's own address; macOS blocks that until the user allows it
    return {
      error:
        "SearXNG started, but Photon can't reach it. If macOS asked whether container-runtime-linux may find devices on your local network, allow it (System Settings → Privacy & Security → Local Network), then try again.",
    };
  }

  return {
    // { url } of a running SearXNG, or { error } to give the model
    async url(signal) {
      ready ??= start(signal);
      const result = await ready;
      if (result.error) ready = undefined; // try again on the next search
      return result;
    },
    available: async () => !!(await findRuntime()),
    stop() {
      if (started) spawn(started.bin, ["rm", "-f", NAME], { env: started.env, detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    },
  };
}
