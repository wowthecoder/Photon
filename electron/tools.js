import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { editFile, readFile, resolvePath, writeFile } from "./files.js";

// Tools built into Photon, offered to the model next to the connectors' tools.
const TIMEOUT = 120_000;
// the first run_code of a launch pulls the Python image (about 50 MB)
const PULL_TIMEOUT = 600_000;
// local models often have 8–32k tokens of context; one `ls -R` shouldn't fill it
const HEAD = 2_000;
const TAIL = 6_000;
const IMAGE = "python:3.14-slim";
const SANDBOX_NETWORK = "photon-sandbox";

// Runs a program in a new process group, so a timeout or Stop also kills what it started.
// onKill cleans up what lives outside that group, e.g. a container. input is written to stdin; without it stdin is closed.
// Output keeps its start and end (errors and summaries are usually at the end), ending with the exit code.
export function run(file, args, { cwd, env, input, signal, timeout = TIMEOUT, onKill }) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env, detached: true, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    child.stdin?.on("error", () => {}).end(input);
    let head = "", tail = "", total = 0, why = "";
    const add = (s) => {
      total += s.length;
      const take = s.slice(0, HEAD - head.length);
      head += take;
      tail = (tail + s.slice(take.length)).slice(-TAIL);
    };
    for (const pipe of [child.stdout, child.stderr]) pipe.setEncoding("utf8").on("data", add);
    const kill = (reason) => {
      if (why) return;
      why = reason;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      onKill?.();
    };
    const timer = setTimeout(() => kill(`Timed out after ${timeout / 1000} s.`), timeout);
    const onAbort = () => kill("Stopped by the user.");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
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

// zsh -l loads the user's login PATH: apps opened from the Dock get a minimal one without Homebrew.
export function runBash(command, { cwd, signal, timeout }) {
  fs.mkdirSync(cwd, { recursive: true });
  return run("/bin/zsh", ["-lc", command], { cwd, signal, timeout });
}

// The login shell's PATH, for finding and running Docker or Apple's container outside the shell.
let loginPath;
const getLoginPath = () => (loginPath ??= promisify(execFile)("/bin/zsh", ["-lc", 'printf %s "$PATH"']).then((r) => r.stdout, () => process.env.PATH ?? ""));

// Apple's container first, then Docker (Docker Desktop, OrbStack, Colima).
// flags: what run needs to cut the network off and keep progress lines out of the output.
// setup runs once a launch. Apple's service doesn't start at login unless set up to, so Photon starts it
// (a no-op when it's running; a fresh install also downloads its Linux kernel). Docker Desktop is an app; start it yourself.
// Docker cuts the network off entirely. Apple's container has no "none" network; a host-only network without DNS
// is the closest: the container can't reach the internet, but can reach services on the Mac that listen beyond 127.0.0.1.
export const RUNTIMES = [
  { bin: "container", flags: ["--network", SANDBOX_NETWORK, "--no-dns", "--progress", "none"], setup: [["system", "start", "--enable-kernel-install"], ["network", "create", "--internal", SANDBOX_NETWORK]] },
  { bin: "docker", flags: ["--network", "none", "--quiet"], setup: [] },
];

async function findRuntime() {
  const PATH = await getLoginPath();
  const dirs = PATH.split(":");
  const rt = RUNTIMES.find((r) => dirs.some((d) => fs.existsSync(path.join(d, r.bin))));
  return rt && { ...rt, env: { ...process.env, PATH } };
}

// Runs Python in a throwaway container: no network, 1 GB of memory, 2 CPUs, and the workspace mounted at /work.
// The first run of a launch sets up the runtime and pulls the image, so the pull doesn't count toward the run's timeout.
// Setup failures are ignored: the network or image may already be there, and if not, the run says what's wrong.
export function createSandbox({ workspace, findRuntime: find = findRuntime }) {
  let ready;

  async function prepare(rt, signal) {
    ready ??= (async () => {
      for (const args of [...rt.setup, ["image", "pull", IMAGE]]) await run(rt.bin, args, { env: rt.env, signal, timeout: PULL_TIMEOUT });
    })();
    await ready;
    if (signal?.aborted) ready = undefined; // Stop during the pull: try again next time
  }

  async function runCode(code, signal) {
    const rt = await find();
    if (!rt) return "Error: run_code needs Docker or Apple's container, and neither is installed.";
    const cwd = workspace();
    fs.mkdirSync(cwd, { recursive: true });
    await prepare(rt, signal);
    if (signal?.aborted) return "(no output)\n[Stopped by the user.]";
    const name = `photon-${randomUUID().slice(0, 8)}`;
    // killing the CLI doesn't stop the container, so a timeout or Stop removes it by name
    const onKill = () => spawn(rt.bin, ["rm", "-f", name], { env: rt.env, stdio: "ignore" }).on("error", () => {});
    const args = ["run", "--rm", "-i", "--name", name, "--memory", "1G", "--cpus", "2", ...rt.flags, "-v", `${cwd}:/work`, "-w", "/work", IMAGE, "python", "-u", "-"];
    const out = await run(rt.bin, args, { cwd, env: rt.env, input: code, signal, onKill });
    // the kernel kills a container that runs out of memory without a word
    return out.replace(/\[exit code 137\]$/, "[exit code 137: killed, probably for using more than 1 GB of memory]");
  }

  return { available: async () => !!(await find()), runCode };
}

// workspace() is the folder bash commands start in, mounted at /work for run_code.
// web: { canSearch(), search(query, signal), read(url, { offset, signal }) } for web_search and web_fetch.
export function createTools({ workspace, findRuntime, web }) {
  const sandbox = createSandbox({ workspace, findRuntime });
  const bash = {
    name: "bash",
    description: `Runs a shell command with zsh on the user's Mac and returns its output (stdout and stderr together) and exit code. Each command runs in a new shell that starts in ${workspace()}, so cd doesn't carry over. Commands can't read input and are stopped after ${TIMEOUT / 1000} seconds.`,
    parameters: { type: "object", properties: { command: { type: "string", description: "The command to run" } }, required: ["command"] },
    readOnly: false,
    warning: "It runs on your Mac with your permissions.",
  };
  const runCode = {
    name: "run_code",
    description: `Runs Python 3.14 code in an isolated Linux container and returns what it prints (stdout and stderr together) and the exit code. Use it for calculations, data processing and checking your reasoning. Print every result you need. Only the standard library is installed and there's no network access, so pip install won't work. Each run starts a new Python process, so variables don't carry over, but files written in the working folder /work do. Runs are stopped after ${TIMEOUT / 1000} seconds.`,
    parameters: { type: "object", properties: { code: { type: "string", description: "The Python code to run" } }, required: ["code"] },
    // readOnly means it runs without asking: it can only touch the workspace
    readOnly: true,
  };

  const webSearch = {
    name: "web_search",
    description: "Searches the web and returns the top results, each with its title, address and a short excerpt. Use it for recent events and for facts you aren't sure of, then read the most useful pages with web_fetch.",
    parameters: { type: "object", properties: { query: { type: "string", description: "What to search for" } }, required: ["query"] },
    readOnly: true,
  };
  const webFetch = {
    name: "web_fetch",
    description: "Reads a web page and returns its title, address and text, up to 8,000 characters at a time. When the text goes on, the result says which offset to call again with.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The page's full http or https address" }, offset: { type: "integer", description: "Where to start reading, in characters. Leave it out to start at the beginning." } },
      required: ["url"],
    },
    // asks unless the address is already in the chat (the chat checks)
    readOnly: false,
    warning: "It sends this address to the website.",
  };

  // askOutsideWorkspace: runs without asking when its path is in the workspace (the chat checks with main)
  const where = `Relative paths start in the workspace folder, ${workspace()}, where you can work freely; anywhere else the user is asked first.`;
  const pathParam = { type: "string", description: "The file's path, absolute or relative to the workspace folder" };
  const readFileTool = {
    name: "read_file",
    description: `Reads a text file and returns its contents, up to 8,000 characters at a time; when it goes on, the result says which offset to call again with. Given a folder, lists what's in it. ${where}`,
    parameters: { type: "object", properties: { path: pathParam, offset: { type: "integer", description: "Where to start reading, in characters. Leave it out to start at the beginning." } }, required: ["path"] },
    readOnly: false,
    askOutsideWorkspace: true,
    warning: "It reads a file outside Photon's workspace folder.",
  };
  const writeFileTool = {
    name: "write_file",
    description: `Creates a text file, or replaces everything in it, creating folders as needed. To change part of an existing file, use edit_file instead. ${where}`,
    parameters: { type: "object", properties: { path: pathParam, content: { type: "string", description: "The file's full new contents" } }, required: ["path", "content"] },
    readOnly: false,
    askOutsideWorkspace: true,
    warning: "It changes a file outside Photon's workspace folder.",
  };
  const editFileTool = {
    name: "edit_file",
    description: `Changes part of a text file: replaces old_text, which must appear exactly once in the file, with new_text. Read the file first and copy old_text exactly, with a few lines around the change so it's unique. ${where}`,
    parameters: {
      type: "object",
      properties: { path: pathParam, old_text: { type: "string", description: "The exact text to replace" }, new_text: { type: "string", description: "What to put in its place" } },
      required: ["path", "old_text", "new_text"],
    },
    readOnly: false,
    askOutsideWorkspace: true,
    warning: "It changes a file outside Photon's workspace folder.",
  };

  const all = [bash, runCode, webSearch, webFetch, readFileTool, writeFileTool, editFileTool];
  const has = (name) => all.some((t) => t.name === name);
  const tools = async () => [
    bash,
    ...((await sandbox.available()) ? [runCode] : []),
    ...(web ? [...(web.canSearch() ? [webSearch] : []), webFetch] : []),
    readFileTool,
    writeFileTool,
    editFileTool,
  ];

  async function call(name, args, signal) {
    if (name === "bash") {
      if (typeof args.command !== "string" || !args.command.trim()) return "Error: command must be a non-empty string.";
      return runBash(args.command, { cwd: workspace(), signal });
    }
    if (name === "run_code") {
      if (typeof args.code !== "string" || !args.code.trim()) return "Error: code must be a non-empty string.";
      return sandbox.runCode(args.code, signal);
    }
    if (name === "web_search") {
      if (typeof args.query !== "string" || !args.query.trim()) return "Error: query must be a non-empty string.";
      return web.search(args.query, signal);
    }
    if (name === "web_fetch") {
      if (typeof args.url !== "string") return "Error: url must be a string.";
      const offset = Number.isInteger(args.offset) && args.offset > 0 ? args.offset : 0;
      return web.read(args.url.trim(), { offset, signal });
    }
    if (name === "read_file" || name === "write_file" || name === "edit_file") {
      if (typeof args.path !== "string" || !args.path.trim()) return "Error: path must be a non-empty string.";
      const p = resolvePath(args.path.trim(), workspace());
      if (name === "read_file") return readFile(p, Number.isInteger(args.offset) && args.offset > 0 ? args.offset : 0);
      if (name === "write_file") return typeof args.content === "string" ? writeFile(p, args.content) : "Error: content must be a string.";
      if (typeof args.old_text !== "string" || !args.old_text) return "Error: old_text must be a non-empty string.";
      return typeof args.new_text === "string" ? editFile(p, args.old_text, args.new_text) : "Error: new_text must be a string.";
    }
    return `Error: there is no tool called ${name}.`;
  }

  return { tools, has, call };
}
