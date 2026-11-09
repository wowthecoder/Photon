import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTools, runBash } from "./tools.js";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "photon-tools-"));
const pidFile = path.join(cwd, "child.pid");

// output, exit code and the working folder
assert.equal(await runBash("pwd -P; echo oops >&2; exit 3", { cwd }), `${fs.realpathSync(cwd)}\noops\n[exit code 3]`);

// long output keeps its start and end
const long = await runBash("seq 1 100000", { cwd });
assert.match(long, /^1\n2\n/);
assert.match(long, /characters cut/);
assert.match(long, /\n100000\n\[exit code 0\]$/);
assert.ok(long.length < 9_000);

// a timeout kills the command and anything it started
const alive = (pid) => {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
};
assert.match(await runBash(`sleep 30 & echo $! > ${pidFile}; wait`, { cwd, timeout: 300 }), /\[Timed out after 0.3 s.\]$/);
assert.equal(alive(+fs.readFileSync(pidFile, "utf8")), false);

// so does Stop
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 200);
assert.equal(await runBash("echo started; sleep 30", { cwd, signal: ctrl.signal }), "started\n[Stopped by the user.]");

// the tool checks its arguments
const tools = createTools({ workspace: () => cwd });
assert.match(await tools.call("bash", {}), /^Error: command must be/);
assert.equal(await tools.call("bash", { command: "true" }), "(no output)\n[exit code 0]");

fs.rmSync(cwd, { recursive: true, force: true });
console.log("tools: ok");
