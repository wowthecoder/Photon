import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { editFile, inWorkspace, readFile, resolvePath, writeFile } from "./files.js";
import { createTools } from "./tools.js";

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "photon-files-")));
const ws = path.join(tmp, "workspace");
const outside = path.join(tmp, "outside");
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(outside, "secret.txt"), "secret");

// paths: relative ones start in the workspace, ~ is home
assert.equal(resolvePath("notes.md", ws), path.join(ws, "notes.md"));
assert.equal(resolvePath("~/x", ws), path.join(os.homedir(), "x"));
assert.equal(resolvePath("/etc/hosts", ws), "/etc/hosts");

// the workspace boundary, after following symlinks
assert.equal(inWorkspace(ws, ws), true);
assert.equal(inWorkspace(path.join(ws, "new/deep/file.txt"), ws), true); // doesn't exist yet
assert.equal(inWorkspace(resolvePath("../outside/secret.txt", ws), ws), false);
assert.equal(inWorkspace(path.join(tmp, "workspace-other/x"), ws), false); // same prefix, different folder
assert.equal(inWorkspace("/etc/hosts", ws), false);
fs.symlinkSync(outside, path.join(ws, "link"));
assert.equal(inWorkspace(path.join(ws, "link/secret.txt"), ws), false);
assert.equal(inWorkspace(path.join(ws, "link/new.txt"), ws), false); // a new file through the link

// write, read in parts, list
const notes = path.join(ws, "dir/notes.md");
assert.equal(writeFile(notes, "hello\n"), `Created ${notes} (6 characters).`);
assert.equal(writeFile(notes, "a".repeat(9_000)), `Replaced ${notes} (9000 characters).`);
assert.match(readFile(notes), /^a{8000}\n\n\[1000 more characters: call read_file again with offset 8000\]$/);
assert.equal(readFile(notes, 8_000), "a".repeat(1_000));
assert.equal(readFile(notes, 20_000), "(nothing after this offset)");
assert.equal(readFile(path.join(ws, "dir")), `${path.join(ws, "dir")}/\nnotes.md  8.8 KB`);
assert.match(writeFile(path.join(ws, "dir"), "x"), /is a folder/);
fs.writeFileSync(path.join(ws, "empty.txt"), "");
assert.equal(readFile(path.join(ws, "empty.txt")), "(empty file)");
fs.writeFileSync(path.join(ws, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
assert.match(readFile(path.join(ws, "image.png")), /is a binary file \(7 bytes\), not text/);
assert.match(readFile(path.join(ws, "missing.txt")), /missing\.txt doesn't exist/);

// edit: one exact match, or a clear error
const code = path.join(ws, "app.py");
writeFile(code, "def add(a, b):\n    return a - b\n\nprint(add(1, 2))\n");
assert.equal(editFile(code, "return a - b", "return a + b"), `Edited ${code}.`);
assert.equal(fs.readFileSync(code, "utf8"), "def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n");
assert.match(editFile(code, "return a * b", "x"), /isn't in .*Read the file again/);
assert.match(editFile(code, "a", "x"), /appears \d+ times/);
assert.match(editFile(path.join(ws, "nope.py"), "a", "b"), /doesn't exist/);

// through the tools: relative paths and argument checks
const tools = createTools({ workspace: () => ws, findRuntime: async () => undefined });
assert.equal(await tools.call("read_file", { path: "app.py" }), fs.readFileSync(code, "utf8"));
assert.match(await tools.call("write_file", { path: "x.txt" }), /content must be a string/);
assert.match(await tools.call("edit_file", { path: "app.py", old_text: "", new_text: "x" }), /old_text must be a non-empty string/);
assert.equal(await tools.call("edit_file", { path: "app.py", old_text: "print(add(1, 2))", new_text: "print(add(2, 2))" }), `Edited ${code}.`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("files: ok");
