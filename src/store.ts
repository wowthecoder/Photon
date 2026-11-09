import { useEffect, useState } from "react";

// name is the stored file (<uuid>.<ext>); label is the original file name
export type Attachment = { name: string; kind: "image" | "audio"; label: string };
// args is the raw JSON the model wrote; result is unset until the tool has run
export type ToolCall = { id: string; name: string; args: string; result?: string };
export type Message = { id: string; role: "user" | "assistant"; content: string; reasoning?: string; attachments?: Attachment[]; toolCalls?: ToolCall[] };
// a tool call waiting for the user to allow it
// warning: what the tool may do, shown in the prompt
export type Approval = { chatId: string; call: ToolCall; warning?: string; resolve: (ok: boolean) => void };
export type Chat = { id: string; title: string; model: string; messages: Message[] };
export type View = "chat" | "models" | "images" | "connectors";
export type Theme = "system" | "light" | "dark";
// shell: whether the model may ask to run shell commands (the bash tool)
export type Settings = { model: string; systemPrompt: string; temperature: number; theme: Theme; shell: boolean };

// ponytail: rewrites the whole key on every change (incl. each streamed token); move chats to backend/SQLite when history grows
export function usePersistent<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return initial;
      const parsed = JSON.parse(raw);
      return Array.isArray(initial) ? parsed : { ...initial, ...parsed };
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
