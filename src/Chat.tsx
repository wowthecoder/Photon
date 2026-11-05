import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Chat as ChatT } from "./store";
import { MODELS } from "./llm";
import { NewChatIcon, SendIcon, SidebarIcon, StopIcon } from "./icons";

type Props = {
  chat: ChatT | undefined;
  model: string;
  streaming: boolean;
  sidebarOpen: boolean;
  onModelChange: (model: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNew: () => void;
  onExpand: () => void;
};

export function Chat({ chat, model, streaming, sidebarOpen, onModelChange, onSend, onStop, onNew, onExpand }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = chat?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [chat?.id]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    onSend(text);
    setDraft("");
  };

  return (
    <main className="chat">
      <header className={`titlebar ${sidebarOpen ? "" : "inset"}`}>
        {!sidebarOpen && (
          <>
            <button className="icon-btn" onClick={onExpand} title="Show sidebar (⌘B)"><SidebarIcon /></button>
            <button className="icon-btn" onClick={onNew} title="New chat (⌘N)"><NewChatIcon /></button>
          </>
        )}
        <select className="model-select" value={model} onChange={(e) => onModelChange(e.target.value)} aria-label="Model">
          {MODELS.map((m) => <option key={m}>{m}</option>)}
        </select>
      </header>

      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty"><h1>How can I help?</h1><p className="muted">Running locally on {model}</p></div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.role === "user" ? m.content : m.content ? <Markdown>{m.content}</Markdown> : <span className="typing">●●●</span>}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={(e) => (e.preventDefault(), submit())}>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder="Message Photon"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="send-btn" onClick={onStop} title="Stop"><StopIcon /></button>
        ) : (
          <button type="submit" className="send-btn" disabled={!draft.trim()} title="Send"><SendIcon /></button>
        )}
      </form>
    </main>
  );
}
