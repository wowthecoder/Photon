import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Chat as ChatT } from "./store";
import { modelLabel, type LocalModel } from "./llm";
import { NewChatIcon, SendIcon, SidebarIcon, StopIcon } from "./icons";

type Props = {
  chat: ChatT | undefined;
  model: string;
  models: LocalModel[];
  engine: EngineState;
  streaming: boolean;
  sidebarOpen: boolean;
  onModelChange: (model: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onNew: () => void;
  onExpand: () => void;
  onOpenModels: () => void;
};

export function Chat({ chat, model, models, engine, streaming, sidebarOpen, onModelChange, onSend, onStop, onNew, onExpand, onOpenModels }: Props) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = chat?.messages ?? [];
  const selected = models.find((m) => m.id === model);
  const canSend = engine.status === "ready" && !!selected && !streaming;

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
    if (!text || !canSend) return;
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
        <div className="chat-heading">{chat?.title}</div>
        {selected?.status.value === "loading" && <span className="muted small">Loading model…</span>}
      </header>

      <div className="messages">
        {messages.length === 0 ? (
          <div className="empty">
            <h1>How can I help?</h1>
            {engine.status === "error" ? (
              <p className="muted">{engine.error} <button className="link-btn" onClick={() => window.photon?.restartEngine()}>Restart engine</button></p>
            ) : engine.status === "starting" ? (
              <p className="muted">Starting the model engine…</p>
            ) : models.length === 0 ? (
              <p><button className="primary-btn" onClick={onOpenModels}>Download your first model</button></p>
            ) : (
              <p className="muted">Running locally on {modelLabel(model)}</p>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.reasoning && (
                <details className="reasoning" open={!m.content}>
                  <summary>Thinking</summary>
                  {m.reasoning}
                </details>
              )}
              {m.role === "user" ? m.content : m.content ? <Markdown>{m.content}</Markdown> : !m.reasoning && <span className="typing">●●●</span>}
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
          placeholder={selected ? "Message Photon" : "Choose a downloaded model to start chatting"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {models.length > 0 ? (
          <select className="model-select" value={model} disabled={streaming} onChange={(e) => onModelChange(e.target.value)} aria-label="Model">
            {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m.id)}</option>)}
          </select>
        ) : (
          <button type="button" className="model-select" onClick={onOpenModels}>Download a model</button>
        )}
        {streaming ? (
          <button type="button" className="send-btn" onClick={onStop} title="Stop"><StopIcon /></button>
        ) : (
          <button type="submit" className="send-btn" disabled={!draft.trim() || !canSend} title="Send"><SendIcon /></button>
        )}
      </form>
    </main>
  );
}
