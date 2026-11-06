import { useEffect, useState } from "react";

export type Message = { id: string; role: "user" | "assistant"; content: string; reasoning?: string };
export type Chat = { id: string; title: string; model: string; messages: Message[] };
export type Theme = "system" | "light" | "dark";
export type Settings = { model: string; systemPrompt: string; temperature: number; theme: Theme };

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
