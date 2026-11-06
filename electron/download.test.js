import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { download } from "./download.js";

const body = randomBytes(3_000_000);
let ignoreRange = false;
const server = http.createServer((req, res) => {
  const start = !ignoreRange && req.headers.range ? Number(req.headers.range.match(/bytes=(\d+)-/)[1]) : 0;
  res.writeHead(start ? 206 : 200, { "Content-Length": body.length - start });
  // send slowly in chunks so the abort test can interrupt mid-stream
  let i = start;
  const tick = () => (i >= body.length ? res.end() : (res.write(body.subarray(i, (i += 65536))), setTimeout(tick, 1)));
  tick();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/file`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photon-dl-"));
const dest = path.join(dir, "sub", "model.gguf");

// abort partway, then resume from the .part file
const ctrl = new AbortController();
await assert.rejects(download({ url, dest, size: body.length, signal: ctrl.signal, onProgress: (n) => n > 1_000_000 && ctrl.abort() }));
const partial = fs.statSync(`${dest}.part`).size;
assert.ok(partial > 0 && partial < body.length, "keeps a partial file after abort");
let first;
await download({ url, dest, size: body.length, onProgress: (n) => (first ??= n) });
assert.equal(first, partial, "resumes from the partial size");
assert.ok(fs.readFileSync(dest).equals(body), "resumed file matches");
assert.ok(!fs.existsSync(`${dest}.part`));

// a server that ignores Range restarts from zero instead of corrupting the file
fs.renameSync(dest, `${dest}.part`);
fs.truncateSync(`${dest}.part`, 500_000);
ignoreRange = true;
await download({ url, dest, size: body.length });
assert.ok(fs.readFileSync(dest).equals(body), "restarted file matches");

// a short stream keeps the .part for resuming; an oversized one is removed
ignoreRange = false;
fs.rmSync(dest);
await assert.rejects(download({ url, dest, size: body.length + 1 }), /closed early/);
assert.equal(fs.statSync(`${dest}.part`).size, body.length);
await assert.rejects(download({ url, dest, size: body.length - 1 }), /expected/);
assert.ok(!fs.existsSync(dest) && !fs.existsSync(`${dest}.part`));

server.close();
fs.rmSync(dir, { recursive: true });
console.log("download tests passed");
