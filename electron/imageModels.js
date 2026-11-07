import fs from "node:fs";
import path from "node:path";
import families from "./imageFamilies.json" with { type: "json" };
import { download } from "./download.js";

// Each supported base model (e.g. Tongyi-MAI/Z-Image-Turbo) has an sd-server recipe and the extra files it needs
// (text encoder, VAE). Any GGUF quantization of that base from Hugging Face can be downloaded alongside them.
const BASES = new Map(families.flatMap((f) => f.bases.map((b) => [b.id.toLowerCase(), { ...b, family: f.name, maker: f.maker }])));

// sd-server finds files by folder: each recipe slot maps to the folder it scans
const SLOT_DIRS = { diffusion_model: "diffusion_models", llm: "text_encoders", llm_vision: "text_encoders", clip_l: "text_encoders", t5xxl: "text_encoders", tokenizer: "tokenizers", vae: "vae" };
const REPO = /^[\w.-]+\/[\w.-]+$/;
const GGUF = /^(?:[\w.-]+\/)*[\w.-]+\.gguf$/;
const QUANT = /^[\w-]+$/;

const hfUrl = (f) => `https://huggingface.co/${f.repo}/resolve/main/${f.path.split("/").map(encodeURIComponent).join("/")}`;
// diffusion files keep their repo and path so two quantizers' "model-Q4_K_M.gguf" don't collide;
// shared extras are stored once by file name (or by `file` when the name is generic, like tokenizer.json)
const fileId = (f) => (f.slot === "diffusion_model" ? `diffusion_models/${f.repo}/${f.path}` : `${SLOT_DIRS[f.slot]}/${f.file ?? path.basename(f.path)}`);
// one repo can hold several models with the same quantization (e.g. BASE/ and TURBO/ folders), so the path identifies a download
const modelId = (e) => `${e.repo}:${e.path}`;

function validate(spec) {
  const ok =
    spec &&
    typeof spec.repo === "string" && REPO.test(spec.repo) &&
    typeof spec.path === "string" && GGUF.test(spec.path) && !spec.path.split("/").includes("..") &&
    typeof spec.quant === "string" && QUANT.test(spec.quant) &&
    Number.isSafeInteger(spec.size) && spec.size > 0 &&
    typeof spec.base === "string" && BASES.has(spec.base.toLowerCase());
  if (!ok) throw new Error("Invalid image model");
  return { base: BASES.get(spec.base.toLowerCase()).id, repo: spec.repo, path: spec.path, quant: spec.quant, size: spec.size };
}

// Download state lives on disk: models.json lists what you chose to download, each file is either done or a .part.
export function createImageModels(rootDir, onChange) {
  const active = new Map();
  const errors = new Map();
  const manifestPath = () => path.join(rootDir(), "models.json");
  const dest = (f) => path.join(rootDir(), fileId(f));
  const partSize = (f) => (fs.existsSync(`${dest(f)}.part`) ? fs.statSync(`${dest(f)}.part`).size : 0);

  function readManifest() {
    try {
      return JSON.parse(fs.readFileSync(manifestPath(), "utf8")).filter((e) => BASES.has(e.base.toLowerCase()));
    } catch {
      return [];
    }
  }
  function writeManifest(entries) {
    fs.mkdirSync(rootDir(), { recursive: true });
    fs.writeFileSync(manifestPath(), JSON.stringify(entries, null, 2));
  }

  const filesOf = (e) => [{ slot: "diffusion_model", repo: e.repo, path: e.path, size: e.size }, ...BASES.get(e.base.toLowerCase()).files];

  function fileStatus(f) {
    const id = fileId(f);
    if (fs.existsSync(dest(f))) return { id, done: f.size, state: "done" };
    const a = active.get(id);
    const done = a?.done ?? partSize(f);
    return { id, done, state: a ? "downloading" : errors.has(id) ? "error" : done ? "paused" : "missing", error: errors.get(id) };
  }

  const list = () =>
    readManifest().map((e) => {
      const base = BASES.get(e.base.toLowerCase());
      return {
        id: modelId(e),
        name: `${base.id.split("/")[1]} · ${e.quant}`,
        repo: e.repo,
        quant: e.quant,
        base: base.id,
        family: base.family,
        maker: base.maker,
        recipe: base.recipe,
        license: base.license,
        description: base.description,
        edit: base.edit ?? null,
        url: `https://huggingface.co/${e.repo}`,
        files: filesOf(e).map((f) => ({ ...f, ...fileStatus(f) })),
      };
    });

  let timer = null;
  const changed = () => (timer ??= setTimeout(() => ((timer = null), onChange(list())), 250));

  async function fetchFile(f) {
    const id = fileId(f);
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
    const e = readManifest().find((e) => modelId(e) === id);
    if (!e) throw new Error("Unknown image model");
    return e;
  }

  // spec: { base, repo, path, quant, size } for a new download, or a model id to resume one
  function start(spec) {
    let entry;
    if (typeof spec === "string") entry = find(spec);
    else {
      entry = validate(spec);
      const entries = readManifest();
      if (!entries.some((e) => modelId(e) === modelId(entry))) writeManifest([...entries, entry]);
    }
    filesOf(entry).forEach(fetchFile);
  }

  function remove(id) {
    const entries = readManifest();
    const entry = find(id);
    const others = entries.filter((e) => modelId(e) !== id);
    const keep = new Set(others.flatMap((e) => filesOf(e).map(fileId)));
    for (const f of filesOf(entry)) {
      if (keep.has(fileId(f))) continue;
      active.get(fileId(f))?.ctrl.abort();
      errors.delete(fileId(f));
      fs.rmSync(dest(f), { force: true });
      fs.rmSync(`${dest(f)}.part`, { force: true });
      // drop the now-empty diffusion_models/<author>/<repo>/... folders; rmdir refuses non-empty ones
      const top = path.join(rootDir(), "diffusion_models");
      if (f.slot === "diffusion_model")
        for (let dir = path.dirname(dest(f)); dir.startsWith(top + path.sep); dir = path.dirname(dir))
          try {
            fs.rmdirSync(dir);
          } catch {
            break;
          }
    }
    writeManifest(others);
    changed();
  }

  return {
    list,
    start,
    pause: (id) => filesOf(find(id)).forEach((f) => active.get(fileId(f))?.ctrl.abort()),
    remove,
  };
}
