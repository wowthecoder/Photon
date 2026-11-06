import fs from "node:fs";
import path from "node:path";
import catalog from "./imageModels.json" with { type: "json" };
import { download } from "./download.js";

// sd-server finds files by folder: each recipe slot maps to the folder it scans
const SLOT_DIRS = { diffusion_model: "diffusion_models", llm: "text_encoders", vae: "vae" };
const localId = (f) => `${SLOT_DIRS[f.slot]}/${path.basename(f.path)}`;
const hfUrl = (f) => `https://huggingface.co/${f.repo}/resolve/main/${f.path.split("/").map(encodeURIComponent).join("/")}`;

// Curated image models: download state lives on disk (file or file.part), plus in-flight downloads and their errors.
// Files shared between models (e.g. one text encoder) are stored and downloaded once.
export function createImageModels(rootDir, onChange) {
  const active = new Map();
  const errors = new Map();
  const dest = (f) => path.join(rootDir(), localId(f));
  const partSize = (f) => (fs.existsSync(`${dest(f)}.part`) ? fs.statSync(`${dest(f)}.part`).size : 0);

  function fileStatus(f) {
    const id = localId(f);
    if (fs.existsSync(dest(f))) return { id, done: f.size, state: "done" };
    const a = active.get(id);
    const done = a?.done ?? partSize(f);
    return { id, done, state: a ? "downloading" : errors.has(id) ? "error" : done ? "paused" : "missing", error: errors.get(id) };
  }
  const list = () => catalog.map((m) => ({ ...m, files: m.files.map((f) => ({ ...f, ...fileStatus(f) })) }));

  let timer = null;
  const changed = () => (timer ??= setTimeout(() => ((timer = null), onChange(list())), 250));

  async function fetchFile(f) {
    const id = localId(f);
    if (active.has(id) || fs.existsSync(dest(f))) return;
    const a = { ctrl: new AbortController(), done: partSize(f) };
    active.set(id, a);
    errors.delete(id);
    changed();
    try {
      await download({ url: hfUrl(f), dest: dest(f), size: f.size, signal: a.ctrl.signal, onProgress: (n) => ((a.done = n), changed()) });
    } catch (e) {
      if (!a.ctrl.signal.aborted) errors.set(id, e.message);
    } finally {
      active.delete(id);
      changed();
    }
  }

  function find(id) {
    const m = catalog.find((m) => m.id === id);
    if (!m) throw new Error("Unknown image model");
    return m;
  }

  function remove(id) {
    const model = find(id);
    const own = new Set(model.files.map(localId));
    // keep files another model is using, i.e. one that has some of its other files on disk
    const keep = new Set(
      catalog
        .filter((o) => o !== model && o.files.some((f) => !own.has(localId(f)) && (fs.existsSync(dest(f)) || partSize(f))))
        .flatMap((o) => o.files.map(localId)),
    );
    for (const f of model.files) {
      if (keep.has(localId(f))) continue;
      active.get(localId(f))?.ctrl.abort();
      errors.delete(localId(f));
      fs.rmSync(dest(f), { force: true });
      fs.rmSync(`${dest(f)}.part`, { force: true });
    }
    changed();
  }

  return {
    list,
    start: (id) => void find(id).files.forEach(fetchFile),
    pause: (id) => find(id).files.forEach((f) => active.get(localId(f))?.ctrl.abort()),
    remove,
  };
}
