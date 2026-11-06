import assert from "node:assert/strict";
import { defaultQuant, formatParams, groupVariants, quantTag } from "./catalog.ts";

assert.equal(quantTag("Qwen3-8B-Q4_K_M.gguf"), "Q4_K_M");
assert.equal(quantTag("Llama-3.2-3B-Instruct-IQ4_XS.gguf"), "IQ4_XS");
assert.equal(quantTag("Qwen3-30B-A3B-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL");
assert.equal(quantTag("Q8_0/Qwen3-32B-Q8_0-00001-of-00002.gguf"), "Q8_0");
assert.equal(quantTag("gemma-3-1b-it-f16.gguf"), "F16");
assert.equal(quantTag("gpt-oss-20b-mxfp4.gguf"), "MXFP4");
assert.equal(quantTag("mmproj-model-f16.gguf"), undefined);
assert.equal(quantTag("README.md"), undefined);
const repo = (id: string, downloads: number, ...tags: string[]) => ({ id, downloads, gated: false as const, tags, gguf: { context_length: 8192 } });
const repos = [
  repo("unsloth/Qwen3-8B-GGUF", 100, "base_model:quantized:Qwen/Qwen3-8B"),
  repo("bartowski/Qwen_Qwen3-8B-GGUF", 300, "base_model:quantized:Qwen/Qwen3-8B"),
  repo("someone/Qwen3-8B-GGUF", 999, "base_model:quantized:Qwen/Qwen3-8B"),
  repo("bartowski/mlabonne_Qwen3-8B-abliterated-GGUF", 50, "base_model:quantized:mlabonne/Qwen3-8B-abliterated"),
  repo("Qwen/Qwen3-4B-GGUF", 10, "base_model:quantized:Qwen/Qwen3-4B"),
  repo("Qwen/Qwen3-8B-GGUF", 7),
  repo("tuner/Qwen3-8B-Uncensored-GGUF", 500, "base_model:Qwen/Qwen3-8B", "base_model:finetune:Qwen/Qwen3-8B"),
  { id: "x/audio-tokenizer-GGUF", downloads: 9999, gated: false as const, tags: [] },
];
const summary = (vs: ReturnType<typeof groupVariants>) => vs.map((v) => [v.id, v.downloads, v.sources.map((s) => `${s.author}:${s.kind}`)]);
assert.deepEqual(summary(groupVariants(repos, "Qwen")), [
  ["Qwen/Qwen3-8B", 407, ["Qwen:official", "bartowski:trusted", "unsloth:trusted"]],
  ["Qwen/Qwen3-4B", 10, ["Qwen:official"]],
]);
assert.deepEqual(summary(groupVariants(repos)), [
  ["Qwen/Qwen3-8B", 1406, ["Qwen:official", "bartowski:trusted", "unsloth:trusted", "someone:community"]],
  ["tuner/Qwen3-8B-Uncensored", 500, ["tuner:community"]],
  ["mlabonne/Qwen3-8B-abliterated", 50, ["bartowski:trusted"]],
  ["Qwen/Qwen3-4B", 10, ["Qwen:official"]],
]);
const q = (tag: string, size: number) => ({ tag, size });
assert.equal(defaultQuant([q("Q2_K", 1), q("UD-Q4_K_XL", 4), q("BF16", 16)]).tag, "UD-Q4_K_XL");
assert.equal(defaultQuant([q("Q3_K_M", 3e9), q("Q6_K", 6e9), q("BF16", 16e9)], 16e9).tag, "Q6_K");
assert.equal(formatParams(999_885_952), "1.0B");
assert.equal(formatParams(8_190_735_360), "8.2B");
assert.equal(formatParams(26_000_000_000), "26B");
assert.equal(formatParams(134_515_008), "135M");
console.log("catalog ok");
