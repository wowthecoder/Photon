import { attachmentPart } from "./attachments";
import type { Message, Settings } from "./store";

export type ModelStatus = "downloading" | "incomplete" | "unloaded" | "loading" | "loaded" | "sleeping";
export type LocalModel = {
  id: string;
  status: { value: ModelStatus; progress?: Record<string, Progress> };
  // what the model can read besides text, e.g. ["text", "image", "audio"]; older servers omit it
  architecture?: { input_modalities?: string[] };
};
export type Progress = { done: number; total: number };
export type ModelEvent = { model: string; event: string; data?: { progress?: Record<string, Progress>; status?: string } };

export const isReady = (m: LocalModel) => !["downloading", "incomplete"].includes(m.status.value);
export const inputsOf = (m: LocalModel | undefined) => m?.architecture?.input_modalities ?? ["text"];

export const sumProgress = (files: Record<string, Progress> = {}) =>
  Object.values(files).reduce((a, f) => ({ done: a.done + f.done, total: a.total + f.total }), { done: 0, total: 0 });

export function modelLabel(id: string) {
  const [repo, tag] = id.split(":");
  const name = repo.split("/").pop()!.replace(/-GGUF$/i, "");
  return tag ? `${name} · ${tag}` : name;
}

export async function api(engine: EngineState, path: string, init: RequestInit = {}) {
  if (engine.status !== "ready") throw new Error("The model engine is not running.");
  const res = await fetch(engine.url + path, {
    ...init,
    headers: { Authorization: `Bearer ${engine.apiKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => null))?.error;
    throw new Error(error?.message ?? (typeof error === "string" ? error : `HTTP ${res.status}`));
  }
  return res;
}

export const post = (engine: EngineState, path: string, body: object, signal?: AbortSignal) =>
  api(engine, path, { method: "POST", body: JSON.stringify(body), signal });

async function* sse(res: Response) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const events = (buf += value.replaceAll("\r", "")).split("\n\n");
    buf = events.pop()!;
    for (const e of events) for (const line of e.split("\n")) if (line.startsWith("data:")) yield line.slice(5).trim();
  }
}

export const listModels = async (engine: EngineState): Promise<LocalModel[]> => (await (await api(engine, "/models")).json()).data;
export const downloadModel = (engine: EngineState, model: string) => post(engine, "/models", { model });
// the router uses one endpoint both to stop a download and to free a loaded model
export const unloadModel = (engine: EngineState, model: string) => post(engine, "/models/unload", { model });
export const pauseDownload = unloadModel;
export const deleteModel = (engine: EngineState, model: string) =>
  api(engine, `/models?model=${encodeURIComponent(model)}`, { method: "DELETE" });

export async function watchModels(engine: EngineState, onEvent: (e: ModelEvent) => void, signal: AbortSignal) {
  const res = await api(engine, "/models/sse", { signal });
  for await (const data of sse(res)) onEvent(JSON.parse(data));
}

// Attachments the model can't read are left out (e.g. after switching a chat to a text-only model).
async function toApiMessage({ role, content, attachments = [] }: Message, inputs: string[]) {
  const usable = attachments.filter((a) => inputs.includes(a.kind));
  if (!usable.length) return { role, content };
  return { role, content: [...(content ? [{ type: "text", text: content }] : []), ...(await Promise.all(usable.map(attachmentPart)))] };
}

export async function* streamChat(engine: EngineState, messages: Message[], model: string, settings: Settings, signal: AbortSignal, inputs: string[] = ["text"]) {
  const system = settings.systemPrompt.trim() ? [{ role: "system", content: settings.systemPrompt }] : [];
  const history = await Promise.all(messages.map((m) => toApiMessage(m, inputs)));
  const res = await post(engine, "/v1/chat/completions", { model, stream: true, temperature: settings.temperature, messages: [...system, ...history] }, signal);
  for await (const data of sse(res)) {
    if (data === "[DONE]") return;
    const delta = JSON.parse(data).choices?.[0]?.delta;
    if (delta?.content || delta?.reasoning_content) yield { content: delta.content ?? "", reasoning: delta.reasoning_content ?? "" };
  }
}
