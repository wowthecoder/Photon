import families from "../electron/imageFamilies.json" with { type: "json" };
import { RANK, cached, get, quantTag, quantizedFrom, type Repo, type Source } from "./catalog.ts";

type ImageExtraFile = { slot: string; repo: string; path: string; size: number; file?: string };
type ImageBaseEntry = { id: string; recipe: string; license: string; description: string; edit?: "required" | "optional"; files: ImageExtraFile[] };
export type ImageFamily = { name: string; maker: string; search: string[]; bases: ImageBaseEntry[] };
export type ImageBase = ImageBaseEntry & { family: string; maker: string };
export type ImageVariant = { id: string; name: string; base: ImageBase; downloads: number; sources: Source[] };
export type ImageFile = { tag: string; path: string; size: number };
export type ImageResults = { variants: ImageVariant[]; unsupported: number };

export const IMAGE_FAMILIES = families as ImageFamily[];
export const IMAGE_QUANTIZERS = ["unsloth", "leejet", "QuantStack", "city96"];

// Only base models listed in electron/imageFamilies.json can run: each needs an sd-server recipe and its text encoder and VAE.
const BASES = new Map<string, ImageBase>(IMAGE_FAMILIES.flatMap((f) => f.bases.map((b) => [b.id.toLowerCase(), { ...b, family: f.name, maker: f.maker }])));
// Some image GGUFs (FLUX.2 klein, edit models) are tagged image-to-image
const PIPELINES = ["text-to-image", "image-to-image"];

// Searches also run without a pipeline filter: some image GGUFs have no pipeline tag at all (e.g. realrebelai/KREA-2_GGUFs).
// The base model tag decides what's supported, so untagged LLMs that match just drop out.
function searchRepos(search: string) {
  return Promise.all(
    [...PIPELINES, ...(search ? [""] : [])].map((pipeline) => {
      const q = new URLSearchParams({ filter: "gguf", sort: "downloads", limit: "100" });
      if (pipeline) q.set("pipeline_tag", pipeline);
      if (search) q.set("search", search);
      for (const field of ["downloads", "gated", "tags", "pipeline_tag"]) q.append("expand[]", field);
      return get<Repo[]>(`/api/models?${q}`);
    }),
  ).then((lists) => lists.flat());
}

export function groupImageVariants(repos: Repo[]): ImageResults {
  const variants = new Map<string, ImageVariant>();
  const unsupported = new Set<string>();
  for (const r of repos) {
    // like text models, only quantizations count; finetunes have their own base_model:finetune tag
    const base = BASES.get(quantizedFrom(r.tags)?.toLowerCase() ?? "");
    if (!base) {
      // only count what's tagged as an image model, not text models that matched the search
      if (PIPELINES.includes(r.pipeline_tag ?? "")) unsupported.add(r.id);
      continue;
    }
    const author = r.id.split("/")[0];
    const org = base.id.split("/")[0];
    const kind = author.toLowerCase() === org.toLowerCase() ? "official" : IMAGE_QUANTIZERS.includes(author) ? "trusted" : "community";
    const v = variants.get(base.id) ?? { id: base.id, name: base.id.split("/")[1], base, downloads: 0, sources: [] };
    if (v.sources.some((s) => s.repo === r.id)) continue;
    v.sources.push({ repo: r.id, author, downloads: r.downloads, gated: r.gated, kind });
    v.downloads += r.downloads;
    variants.set(base.id, v);
  }
  for (const v of variants.values()) v.sources.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.downloads - a.downloads);
  return { variants: [...variants.values()].sort((a, b) => b.downloads - a.downloads), unsupported: unsupported.size };
}

export const topImageVariants = () => cached("image:top", async () => groupImageVariants(await searchRepos("")));

export const imageFamilyVariants = (f: ImageFamily) =>
  cached(`image:family:${f.name}`, async () => {
    const { variants } = groupImageVariants((await Promise.all(f.search.map(searchRepos))).flat());
    return { variants: variants.filter((v) => v.base.family === f.name), unsupported: 0 };
  });

export const searchImageVariants = async (query: string) => groupImageVariants(await searchRepos(query));

// ponytail: skips split GGUFs (-00001-of-00002); none of the supported image models ship split today
export async function listImageFiles(repo: string): Promise<ImageFile[]> {
  const files = await get<{ path: string; size: number }[]>(`/api/models/${repo}/tree/main?recursive=true`);
  return files
    .filter((f) => f.path.endsWith(".gguf") && !/-\d{5}-of-\d{5}\.gguf$/.test(f.path))
    .flatMap((f) => {
      const tag = quantTag(f.path);
      return tag ? [{ tag, path: f.path, size: f.size }] : [];
    })
    .sort((a, b) => a.size - b.size);
}

export const extrasSize = (base: ImageBase) => base.files.reduce((n, f) => n + f.size, 0);
