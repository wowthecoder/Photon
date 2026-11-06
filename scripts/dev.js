import { spawn } from "node:child_process";
import electron from "electron";
import { createServer } from "vite";
import "./fetch-llama.js";
import "./fetch-sd.js";

const server = await createServer();
await server.listen();
const env = { ...process.env, DEV_URL: server.resolvedUrls.local[0] };
spawn(electron, ["."], { stdio: "inherit", env }).on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
