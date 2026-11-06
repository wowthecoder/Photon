const HF = "https://huggingface.co";

export const QUANTIZERS = ["ggml-org", "unsloth", "bartowski", "lmstudio-community"];

export type Family = { name: string; maker: string; org: string; keywords: string[] };

export const FAMILIES: Family[] = [
  { name: "Qwen", maker: "Alibaba", org: "Qwen", keywords: ["qwen"] },
  { name: "Gemma", maker: "Google", org: "google", keywords: ["gemma"] },
  { name: "GPT-OSS", maker: "OpenAI", org: "openai", keywords: ["gpt-oss"] },
  { name: "DeepSeek", maker: "DeepSeek", org: "deepseek-ai", keywords: ["deepseek"] },
  { name: "Llama", maker: "Meta", org: "meta-llama", keywords: ["llama"] },
  { name: "Mistral", maker: "Mistral AI", org: "mistralai", keywords: ["mistral", "ministral", "devstral", "magistral"] },
  { name: "Nemotron", maker: "NVIDIA", org: "nvidia", keywords: ["nemotron"] },
  { name: "Phi", maker: "Microsoft", org: "microsoft", keywords: ["phi"] },
  { name: "GLM", maker: "Z.ai", org: "zai-org", keywords: ["glm"] },
  { name: "Kimi", maker: "Moonshot AI", org: "moonshotai", keywords: ["kimi"] },
  { name: "MiniMax", maker: "MiniMax", org: "MiniMaxAI", keywords: ["minimax"] },
  { name: "Granite", maker: "IBM", org: "ibm-granite", keywords: ["granite"] },
  { name: "LFM", maker: "Liquid AI", org: "LiquidAI", keywords: ["lfm"] },
  { name: "SmolLM", maker: "Hugging Face", org: "HuggingFaceTB", keywords: ["smollm"] },
];

type Repo = {
  id: string;
  downloads: number;
  gated: false | string;
  pipeline_tag?: string;
  tags?: string[];
  gguf?: { total?: number; context_length?: number };
};
export type Source = { repo: string; author: string; downloads: number; gated: false | string; kind: "official" | "trusted" | "community" };
export type Variant = { id: string; name: string; org: string; params?: number; context?: number; downloads: number; sources: Source[] };
export type Quant = { tag: string; size: number };

const CHAT = new Set([undefined, "text-generation", "image-text-to-text"]);
const RANK = { official: 0, trusted: 1, community: 2 };
const OFFICIAL = new Set(FAMILIES.map((f) => f.org.toLowerCase()));
const QUANT = /[-_.]((?:UD-)?(?:I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4(?:_MOE)?))(?:-\d{5}-of-\d{5})?\.gguf$/i;

export const quantTag = (path: string) => (/mmproj/i.test(path) ? undefined : path.match(QUANT)?.[1].toUpperCase());

const quantizedFrom = (tags: string[] = []) => tags.find((t) => t.startsWith("base_model:quantized:"))?.slice("base_model:quantized:".length);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(HF + path);
  if (!res.ok) throw new Error(`Hugging Face returned ${res.status}`);
  return res.json();
}

function searchRepos(search: string, author?: string, limit = 50) {
  const q = new URLSearchParams({ filter: "gguf", sort: "downloads", limit: String(limit) });
  if (search) q.set("search", search);
  if (author) q.set("author", author);
  for (const field of ["downloads", "gated", "pipeline_tag", "tags", "gguf"]) q.append("expand[]", field);
  return get<Repo[]>(`/api/models?${q}`);
}

export function groupVariants(repos: Repo[], officialOrg?: string): Variant[] {
  const variants = new Map<string, Variant>();
  for (const r of repos) {
    if (!CHAT.has(r.pipeline_tag) || !r.gguf?.context_length || /embed|rerank/i.test(r.id)) continue;
    const author = r.id.split("/")[0];
    const id = quantizedFrom(r.tags) ?? r.id.replace(/-GGUF$/i, "");
    const [org, name] = id.split("/");
    const official = author.toLowerCase() === org.toLowerCase() && OFFICIAL.has(org.toLowerCase());
    const kind = QUANTIZERS.includes(author) ? "trusted" : official ? "official" : "community";
    if (officialOrg && (org.toLowerCase() !== officialOrg.toLowerCase() || kind === "community")) continue;
    const v = variants.get(id) ?? { id, name, org, downloads: 0, sources: [] };
    if (v.sources.some((s) => s.repo === r.id)) continue;
    v.sources.push({ repo: r.id, author, downloads: r.downloads, gated: r.gated, kind });
    v.downloads += r.downloads;
    v.params ??= r.gguf?.total;
    v.context ??= r.gguf?.context_length;
    variants.set(id, v);
  }
  for (const v of variants.values()) v.sources.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.downloads - a.downloads);
  return [...variants.values()].sort((a, b) => b.downloads - a.downloads);
}

const cache = new Map<string, Promise<Variant[]>>();

function cached(key: string, load: () => Promise<Variant[]>) {
  let p = cache.get(key);
  if (!p) {
    p = load();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export const familyVariants = (f: Family) =>
  cached(`family:${f.name}`, async () => {
    const lists = await Promise.all(f.keywords.flatMap((k) => [...QUANTIZERS, f.org].map((a) => searchRepos(k, a))));
    return groupVariants(lists.flat(), f.org);
  });

export const topVariants = () => cached("top", async () => groupVariants(await searchRepos("", undefined, 100)).slice(0, 25));

export const searchVariants = async (query: string) => groupVariants(await searchRepos(query));

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

export const estimateQ4 = (params: number) => params * 0.6;

export const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} KB`;

export const formatCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

export const formatParams = (n: number) => (n >= 9.95e8 ? `${(n / 1e9).toFixed(n >= 9.95e9 ? 0 : 1)}B` : `${Math.round(n / 1e6)}M`);

const PREFERRED = ["Q4_K_M", "UD-Q4_K_XL", "Q4_K_S", "Q4_0", "MXFP4", "MXFP4_MOE", "IQ4_XS", "Q8_0"];

export const defaultQuant = (quants: Quant[], totalMem = Infinity) =>
  PREFERRED.map((t) => quants.find((q) => q.tag === t)).find(Boolean) ??
  [...quants].reverse().find((q) => fits(q.size, totalMem)) ??
  quants[0];
