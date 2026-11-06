import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BUILD = "b12138";
const dir = path.join(import.meta.dirname, "../resources/llama");
const marker = path.join(dir, "BUILD");

if (!fs.existsSync(marker) || fs.readFileSync(marker, "utf8") !== BUILD) {
  console.log(`Fetching llama.cpp ${BUILD}...`);
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${BUILD}/llama-${BUILD}-bin-macos-arm64.tar.gz`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const tmp = path.join(os.tmpdir(), `llama-${BUILD}.tar.gz`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const root = `llama-${BUILD}`;
  execFileSync("tar", ["xzf", tmp, "-C", dir, "--strip-components", "1", `${root}/llama-server`, `${root}/*.dylib`, `${root}/LICENSE`]);
  fs.rmSync(tmp);
  fs.writeFileSync(marker, BUILD);
}
