import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSearxng } from "./searxng.js";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "photon-searxng-"));
const dir = path.join(tmp, "searxng");
const log = path.join(tmp, "runtime.log");
const pidFile = path.join(tmp, "server.pid");

// A stand-in for docker: logs its arguments; "run" starts a web server on the published port, "rm" stops it.
const fake = (runExit = 0) => {
  const bin = path.join(tmp, `fake-${runExit}`);
  fs.writeFileSync(
    bin,
    `#!/bin/sh
echo "$@" >> '${log}'
case "$1" in
  run)
    [ ${runExit} -ne 0 ] && echo "no space left" && exit ${runExit}
    port=$(echo "$@" | sed -E 's/.*127\\.0\\.0\\.1:([0-9]+):8080.*/\\1/')
    nohup node -e "require('http').createServer((q, s) => s.end('OK')).listen($port, '127.0.0.1')" >/dev/null 2>&1 &
    echo $! > '${pidFile}'
    echo container-id ;;
  rm) [ -f '${pidFile}' ] && kill $(cat '${pidFile}') 2>/dev/null; rm -f '${pidFile}' ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return { bin, setup: [], env: process.env };
};
const calls = () => fs.readFileSync(log, "utf8").trim().split("\n");

// starts once, with JSON on, a secret, and the port published on 127.0.0.1 only
const searxng = createSearxng({ dir: () => dir, findRuntime: async () => fake() });
const [first, second] = await Promise.all([searxng.url(), searxng.url()]);
assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(second.url, first.url);
assert.equal(await (await fetch(`${first.url}/healthz`)).text(), "OK");
assert.equal((await searxng.url()).url, first.url);
assert.deepEqual(
  calls().map((c) => c.split(" ").slice(0, 2).join(" ")),
  ["image pull", "rm -f", "run -d"],
);
assert.ok(calls()[2].includes(`-p 127.0.0.1:${first.url.split(":").pop()}:8080 -v ${dir}:/etc/searxng searxng/searxng:latest`), calls()[2]);
const yml = fs.readFileSync(path.join(dir, "settings.yml"), "utf8");
assert.match(yml, /secret_key: "[0-9a-f]{64}"/);
assert.match(yml, /formats: \[html, json\]/);
assert.match(yml, /limiter: false/);

// quitting removes it
searxng.stop();
await new Promise((r) => setTimeout(r, 500));
await assert.rejects(fetch(`${first.url}/healthz`));
assert.equal(calls().at(-1), "rm -f photon-searxng");

// a later launch keeps the same settings (and secret)
const again = createSearxng({ dir: () => dir, findRuntime: async () => fake() });
assert.match((await again.url()).url, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(fs.readFileSync(path.join(dir, "settings.yml"), "utf8"), yml);
again.stop();

// errors the model can pass on, and a retry on the next search
const none = createSearxng({ dir: () => dir, findRuntime: async () => undefined });
assert.match((await none.url()).error, /needs Docker or Apple's container/);
assert.equal(await none.available(), false);
const broken = createSearxng({ dir: () => dir, findRuntime: async () => fake(1) });
assert.match((await broken.url()).error, /couldn't start SearXNG: no space left/);
const runs = calls().filter((c) => c.startsWith("run ")).length;
await broken.url();
assert.equal(calls().filter((c) => c.startsWith("run ")).length, runs + 1); // tried again

await new Promise((r) => setTimeout(r, 300));
fs.rmSync(tmp, { recursive: true, force: true });
console.log("searxng: ok");
