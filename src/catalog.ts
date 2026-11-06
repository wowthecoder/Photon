const HF = "https://huggingface.co";

export const PUBLISHERS = ["ggml-org", "unsloth", "bartowski", "lmstudio-community"];

export type Repo = { id: string; downloads: number; likes: number; gated: false | string; pipeline_tag?: string };
export type Quant = { tag: string; size: number };

const NOT_CHAT = new Set(["feature-extraction", "sentence-similarity", "text-ranking", "text-classification"]);

const QUANT = /[-_.]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?:-\d{5}-of-\d{5})?\.gguf$/i;

export const quantTag = (path: string) => (/mmproj/i.test(path) ? undefined : path.match(QUANT)?.[1].toUpperCase());

async function get<T>(path: string): Promise<T> {
  const res = await fetch(HF + path);
  if (!res.ok) throw new Error(`Hugging Face returned ${res.status}`);
  return res.json();
}

export async function searchRepos(search: string, author?: string) {
  const q = new URLSearchParams({ filter: "gguf", sort: "downloads", limit: "40" });
  if (search) q.set("search", search);
  if (author) q.set("author", author);
  for (const field of ["downloads", "likes", "gated", "pipeline_tag"]) q.append("expand[]", field);
  const repos = await get<Repo[]>(`/api/models?${q}`);
  return repos.filter((r) => !NOT_CHAT.has(r.pipeline_tag ?? "") && !/embed|rerank/i.test(r.id));
}

export async function listQuants(repo: string): Promise<Quant[]> {
  const files = await get<{ path: string; size: number }[]>(`/api/models/${repo}/tree/main?recursive=true`);
  const sizes = new Map<string, number>();
  for (const f of files) {
    const tag = quantTag(f.path);
    if (tag) sizes.set(tag, (sizes.get(tag) ?? 0) + f.size);
  }
  return [...sizes].map(([tag, size]) => ({ tag, size })).sort((a, b) => a.size - b.size);
}

export const fits = (size: number, totalMem: number) => size * 1.2 < totalMem * 0.7;

export const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;
