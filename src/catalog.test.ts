import assert from "node:assert/strict";
import { quantTag } from "./catalog.ts";

assert.equal(quantTag("Qwen3-8B-Q4_K_M.gguf"), "Q4_K_M");
assert.equal(quantTag("Llama-3.2-3B-Instruct-IQ4_XS.gguf"), "IQ4_XS");
assert.equal(quantTag("Qwen3-30B-A3B-UD-Q4_K_XL.gguf"), "UD-Q4_K_XL");
assert.equal(quantTag("Q8_0/Qwen3-32B-Q8_0-00001-of-00002.gguf"), "Q8_0");
assert.equal(quantTag("gemma-3-1b-it-f16.gguf"), "F16");
assert.equal(quantTag("gpt-oss-20b-mxfp4.gguf"), "MXFP4");
assert.equal(quantTag("mmproj-model-f16.gguf"), undefined);
assert.equal(quantTag("README.md"), undefined);
console.log("catalog ok");
