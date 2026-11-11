import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// read_file, write_file and edit_file. They run without asking inside the workspace and ask first anywhere else.
const PAGE = 8_000; // characters per read, like the other tools' output
const MAX_READ = 20 * 1024 * 1024;
const MAX_ENTRIES = 200;

// Relative paths start in the workspace; ~ is the home folder.
export const resolvePath = (p, workspace) => path.resolve(workspace, p.replace(/^~(?=$|\/)/, os.homedir()));

// The real path of p: symlinks resolved, also for a file that doesn't exist yet (through its nearest existing folder).
function realPath(p) {
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(p), ...rest.reverse());
    } catch {}
    const up = path.dirname(p);
    if (up === p) return path.join(p, ...rest.reverse());
    rest.push(path.basename(p));
    p = up;
  }
}

// Whether p is in the workspace, after following symlinks, so a link can't lead out of it.
export function inWorkspace(p, workspace) {
  fs.mkdirSync(workspace, { recursive: true });
  const root = fs.realpathSync(workspace);
  const real = realPath(p);
  return real === root || real.startsWith(root + path.sep);
}

const size = (n) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const failure = (p, e) => `Error: ${e.code === "ENOENT" ? `${p} doesn't exist.` : e.code === "EACCES" || e.code === "EPERM" ? `Photon isn't allowed to open ${p}.` : e.message}`;

function list(p) {
  const entries = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const lines = entries.slice(0, MAX_ENTRIES).map((e) => {
    if (e.isDirectory()) return `${e.name}/`;
    try {
      return `${e.name}  ${size(fs.statSync(path.join(p, e.name)).size)}`;
    } catch {
      return e.name; // e.g. a broken symlink
    }
  });
  const more = entries.length - lines.length;
  return `${p}/\n${lines.join("\n") || "(empty folder)"}${more > 0 ? `\n… and ${more} more` : ""}`;
}

// A file's text from offset, with a note when there's more; a folder's entries.
export function readFile(p, offset = 0) {
  try {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) return list(p);
    if (stat.size > MAX_READ) return `Error: ${p} is ${size(stat.size)}, too big to read (the limit is ${size(MAX_READ)}).`;
    const data = fs.readFileSync(p);
    if (data.subarray(0, 8_000).includes(0)) return `Error: ${p} is a binary file (${size(stat.size)}), not text.`;
    const text = data.toString("utf8");
    const part = text.slice(offset, offset + PAGE);
    const rest = text.length - offset - part.length;
    return `${part || (text ? "(nothing after this offset)" : "(empty file)")}${rest > 0 ? `\n\n[${rest} more characters: call read_file again with offset ${offset + part.length}]` : ""}`;
  } catch (e) {
    return failure(p, e);
  }
}

// Creates the file and its folders, or replaces what's there.
export function writeFile(p, content) {
  try {
    const existed = fs.existsSync(p);
    if (existed && fs.statSync(p).isDirectory()) return `Error: ${p} is a folder.`;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return `${existed ? "Replaced" : "Created"} ${p} (${content.length} characters).`;
  } catch (e) {
    return failure(p, e);
  }
}

// Replaces one exact piece of text, which must appear once, so the edit can't land in the wrong place.
export function editFile(p, oldText, newText) {
  try {
    const text = fs.readFileSync(p, "utf8");
    const at = text.indexOf(oldText);
    if (at < 0) return `Error: old_text isn't in ${p}. Read the file again and copy the text exactly, including spaces and line breaks.`;
    const count = text.split(oldText).length - 1;
    if (count > 1) return `Error: old_text appears ${count} times in ${p}. Include more of the text around it, so it appears once.`;
    fs.writeFileSync(p, text.slice(0, at) + newText + text.slice(at + oldText.length));
    return `Edited ${p}.`;
  } catch (e) {
    return failure(p, e);
  }
}
