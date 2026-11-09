import { spawn } from "node:child_process";
import fs from "node:fs";

// Tools built into Photon, offered to the model next to the connectors' tools.
const TIMEOUT = 120_000;
// local models often have 8–32k tokens of context; one `ls -R` shouldn't fill it
const HEAD = 2_000;
const TAIL = 6_000;

// Runs a command with zsh in a new process group, so a timeout or Stop also kills what it started.
// -l loads the user's login PATH: apps opened from the Dock get a minimal one without Homebrew.
// Output keeps its start and end (errors and summaries are usually at the end), ending with the exit code.
export function runBash(command, { cwd, signal, timeout = TIMEOUT }) {
  fs.mkdirSync(cwd, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let head = "", tail = "", total = 0, why = "";
    const add = (s) => {
      total += s.length;
      const take = s.slice(0, HEAD - head.length);
      head += take;
      tail = (tail + s.slice(take.length)).slice(-TAIL);
    };
    for (const pipe of [child.stdout, child.stderr]) pipe.setEncoding("utf8").on("data", add);
    const kill = (reason) => {
      why ||= reason;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const timer = setTimeout(() => kill(`Timed out after ${timeout / 1000} s.`), timeout);
    const onAbort = () => kill("Stopped by the user.");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => add(e.message));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const cut = total - head.length - tail.length;
      const out = (cut > 0 ? `${head}\n… ${cut} characters cut …\n${tail}` : head + tail).trim();
      resolve(`${out || "(no output)"}\n[${why || `exit code ${code}`}]`);
    });
  });
}

// workspace() is the folder commands start in.
export function createTools({ workspace }) {
  const defs = [
    {
      name: "bash",
      description: `Runs a shell command with zsh on the user's Mac and returns its output (stdout and stderr together) and exit code. Each command runs in a new shell that starts in ${workspace()}, so cd doesn't carry over. Commands can't read input and are stopped after ${TIMEOUT / 1000} seconds.`,
      parameters: { type: "object", properties: { command: { type: "string", description: "The command to run" } }, required: ["command"] },
      readOnly: false,
      warning: "It runs on your Mac with your permissions.",
    },
  ];

  const has = (name) => defs.some((d) => d.name === name);

  async function call(name, args, signal) {
    if (name === "bash") {
      if (typeof args.command !== "string" || !args.command.trim()) return "Error: command must be a non-empty string.";
      return runBash(args.command, { cwd: workspace(), signal });
    }
    return `Error: there is no tool called ${name}.`;
  }

  return { tools: () => defs, has, call };
}
