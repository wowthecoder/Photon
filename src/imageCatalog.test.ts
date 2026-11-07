import assert from "node:assert/strict";
import { groupImageVariants } from "./imageCatalog.ts";

const repo = (id: string, downloads: number, ...tags: string[]) => ({ id, downloads, gated: false as const, tags, pipeline_tag: "text-to-image" });
const { variants, unsupported } = groupImageVariants([
  repo("unsloth/Z-Image-Turbo-GGUF", 100, "base_model:quantized:Tongyi-MAI/Z-Image-Turbo"),
  repo("leejet/Z-Image-Turbo-GGUF", 50, "base_model:quantized:Tongyi-MAI/Z-Image-Turbo"),
  repo("someone/Z-Image-Turbo-GGUF", 999, "base_model:quantized:tongyi-mai/z-image-turbo"),
  repo("someone/z-image-finetune-GGUF", 500, "base_model:Tongyi-MAI/Z-Image-Turbo", "base_model:finetune:Tongyi-MAI/Z-Image-Turbo"),
  repo("city96/sdxl-GGUF", 300, "base_model:quantized:stabilityai/stable-diffusion-xl-base-1.0"),
  repo("unsloth/FLUX.2-klein-4B-GGUF", 10, "base_model:quantized:black-forest-labs/FLUX.2-klein-4B"),
  { ...repo("unsloth/Qwen3-8B-GGUF", 900, "base_model:quantized:Qwen/Qwen3-8B"), pipeline_tag: "text-generation" },
  { ...repo("realrebelai/KREA-2_GGUFs", 5, "base_model:quantized:krea/Krea-2-Turbo"), pipeline_tag: undefined },
]);

assert.deepEqual(variants.map((v) => v.id), ["Tongyi-MAI/Z-Image-Turbo", "black-forest-labs/FLUX.2-klein-4B", "krea/Krea-2-Turbo"], "grouped by supported base, by downloads; untagged repos still match by base");
const z = variants[0];
assert.equal(z.base.recipe, "z-image-turbo");
assert.deepEqual(z.sources.map((s) => [s.author, s.kind]), [["unsloth", "trusted"], ["leejet", "trusted"], ["someone", "community"]], "trusted before community, case-insensitive base match");
assert.equal(z.downloads, 1149);
assert.equal(unsupported, 2, "finetunes and unsupported image bases are counted, not listed; text models aren't counted");
console.log("image catalog ok");
