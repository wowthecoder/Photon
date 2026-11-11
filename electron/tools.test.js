import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSandbox, createTools, RUNTIMES, runBash } from "./tools.js";

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

// run_code, against a stand-in for docker that logs its arguments and runs "run" with the local python3
const fake = path.join(cwd, "fake-docker");
const log = path.join(cwd, "docker.log");
fs.writeFileSync(fake, `#!/bin/sh\necho "$@" >> '${log}'\n[ "$1" = run ] && exec python3 -u -\nexit 0\n`, { mode: 0o755 });
const docker = { ...RUNTIMES.find((r) => r.bin === "docker"), bin: fake, env: process.env };
const sandbox = createSandbox({ workspace: () => cwd, findRuntime: async () => docker });
assert.equal(await sandbox.runCode("print(6 * 7)\nopen('x.txt', 'w').write('kept')"), "42\n[exit code 0]");
assert.match(await sandbox.runCode("print(open('x.txt').read()); 1/0"), /^kept\nTraceback[\s\S]*ZeroDivisionError[\s\S]*\[exit code 1\]$/);
const calls = fs.readFileSync(log, "utf8").trim().split("\n");
assert.deepEqual(calls.filter((c) => c.startsWith("image")), ["image pull python:3.14-slim"]); // pulled once
const runArgs = calls.find((c) => c.startsWith("run "));
assert.ok(runArgs.includes("--network none --quiet") && runArgs.includes(`-v ${cwd}:/work -w /work`), runArgs);

// Stop removes the container by name
const stop = new AbortController();
setTimeout(() => stop.abort(), 500);
assert.equal(await sandbox.runCode("import time\nprint('started')\ntime.sleep(30)", stop.signal), "started\n[Stopped by the user.]");
await new Promise((r) => setTimeout(r, 300));
const name = fs.readFileSync(log, "utf8").trim().split("\n").at(-2).match(/--name (\S+)/)[1];
assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").at(-1), `rm -f ${name}`);

// without a runtime, run_code isn't offered
const none = createTools({ workspace: () => cwd, findRuntime: async () => undefined });
assert.deepEqual((await none.tools()).map((t) => t.name), ["bash", "read_file", "write_file", "edit_file"]);
assert.deepEqual((await createTools({ workspace: () => cwd, findRuntime: async () => docker }).tools()).map((t) => t.name), ["bash", "run_code", "read_file", "write_file", "edit_file"]);

fs.rmSync(cwd, { recursive: true, force: true });
console.log("tools: ok");
