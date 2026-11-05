import type { Message, Settings } from "./store";

// Mock backend. Replace with Tauri `invoke` + `listen` once the local model runtime exists.
export const MODELS = ["llama-3.2-3b-instruct", "qwen2.5-7b-instruct", "mistral-7b-instruct"];

export async function* streamChat(messages: Message[], model: string, settings: Settings, signal: AbortSignal) {
  const last = messages[messages.length - 1]?.content ?? "";
  const reply =
    `You said: *"${last}"*\n\nThis is a **mock** reply from \`${model}\` (temperature ${settings.temperature}).\n\n` +
    "```ts\nconst answer = await localModel.generate(prompt);\n```\n\nWire `src/llm.ts` to the Tauri backend to talk to a real model.";
  for (const token of reply.split(/(?<=\s)/)) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 25));
    yield token;
  }
}
