import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { Approval, Attachment, Chat as ChatT, ToolCall } from "./store";
import { inputsOf, modelLabel, type LocalModel } from "./llm";
import { AUDIO_ACCEPT, attachmentUrl, saveAttachment } from "./attachments";
import { AttachIcon, NewChatIcon, SendIcon, SidebarIcon, StopIcon } from "./icons";

type Props = {
  chat: ChatT | undefined;
  model: string;
  models: LocalModel[];
  engine: EngineState;
  streaming: boolean;
  approval: Approval | null;
  sidebarOpen: boolean;
  onModelChange: (model: string) => void;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onNew: () => void;
  onExpand: () => void;
  onOpenModels: () => void;
};

export function Chat({ chat, model, models, engine, streaming, approval, sidebarOpen, onModelChange, onSend, onStop, onNew, onExpand, onOpenModels }: Props) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = chat?.messages ?? [];
  const selected = models.find((m) => m.id === model);
  const canSend = engine.status === "ready" && !!selected && !streaming;
  const inputs = inputsOf(selected);
  const accepts = [inputs.includes("image") && "image/*", inputs.includes("audio") && AUDIO_ACCEPT].filter(Boolean).join(",");
  const unreadable = pending.filter((a) => !inputs.includes(a.kind));

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
    if ((!text && !pending.length) || !canSend) return;
    onSend(text, pending);
    setDraft("");
    setPending([]);
    setAttachError("");
  };

  async function attach(files: FileList | File[] | null | undefined) {
    setAttachError("");
    for (const file of [...(files ?? [])]) {
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") || /\.(mp3|wav|flac)$/i.test(file.name) ? "audio" : null;
      if (!kind || !inputs.includes(kind)) {
        setAttachError(kind ? `${modelLabel(model)} can't read ${kind === "image" ? "images" : "audio"}.` : `Photon can't attach ${file.name}.`);
        continue;
      }
      try {
        const a = await saveAttachment(file);
        setPending((p) => [...p, a]);
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  const unattach = (a: Attachment) => (setPending((p) => p.filter((x) => x !== a)), window.photon?.deleteAttachments([a.name]));

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
          messages.map((m, i) => (
            <div key={m.id} className={`message ${m.role}`}>
              {m.reasoning && (
                <details className="reasoning" open={!m.content}>
                  <summary>Thinking</summary>
                  {m.reasoning}
                </details>
              )}
              {!!m.attachments?.length && (
                <div className="message-attachments">
                  {m.attachments.map((a) => <AttachmentView key={a.name} attachment={a} />)}
                </div>
              )}
              {m.role === "user" ? m.content : m.content ? <Markdown>{m.content}</Markdown> : !m.reasoning && !m.toolCalls && (streaming && i === messages.length - 1 ? <span className="typing">●●●</span> : <span className="muted small">No response</span>)}
              {m.toolCalls?.map((c) => <ToolCallView key={c.id} call={c} waiting={approval?.call.id === c.id} streaming={streaming} />)}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {approval && (
        <div className="approval">
          <div>Run <code>{approval.call.name}</code>? {approval.warning ?? "It may change data in your account."}</div>
          <pre>{prettyArgs(approval.call.args)}</pre>
          <div className="approval-actions">
            <button className="secondary-btn" onClick={() => approval.resolve(false)}>Don't allow</button>
            <button className="primary-btn" onClick={() => approval.resolve(true)} autoFocus>Allow</button>
          </div>
        </div>
      )}
      {(attachError || unreadable.length > 0) && (
        <p className="composer-note">{attachError || `${modelLabel(model)} can't read ${unreadable[0].kind === "image" ? "images" : "audio"}, so the attachment won't be sent.`}</p>
      )}
      <form
        className="composer"
        onSubmit={(e) => (e.preventDefault(), submit())}
        onDragOver={(e) => accepts && e.preventDefault()}
        onDrop={(e) => accepts && (e.preventDefault(), attach(e.dataTransfer.files))}
      >
        {pending.length > 0 && (
          <div className="pending">
            {pending.map((a) => (
              <div key={a.name} className={`pending-item ${a.kind}`} title={a.label}>
                {a.kind === "image" ? <img src={attachmentUrl(a)} alt={a.label} /> : <span className="small">♪ {a.label}</span>}
                <button type="button" className="pending-remove" onClick={() => unattach(a)} aria-label={`Remove ${a.label}`}>×</button>
              </div>
            ))}
          </div>
        )}
        {accepts && (
          <label className="icon-btn attach-btn" title={`Attach ${inputs.includes("image") && inputs.includes("audio") ? "an image or audio" : inputs.includes("image") ? "an image" : "audio"}`}>
            <AttachIcon />
            <input type="file" hidden multiple accept={accepts} disabled={streaming} onChange={(e) => (attach(e.target.files), (e.target.value = ""))} />
          </label>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={selected ? "Message Photon" : "Choose a downloaded model to start chatting"}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => accepts && e.clipboardData.files.length > 0 && (e.preventDefault(), attach(e.clipboardData.files))}
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
          <button type="submit" className="send-btn" disabled={(!draft.trim() && !pending.length) || !canSend} title="Send"><SendIcon /></button>
        )}
      </form>
    </main>
  );
}

function AttachmentView({ attachment }: { attachment: Attachment }) {
  return attachment.kind === "image" ? (
    <img className="message-image" src={attachmentUrl(attachment)} alt={attachment.label} title={attachment.label} />
  ) : (
    <div className="message-audio">
      <span className="small muted">{attachment.label}</span>
      <audio controls src={attachmentUrl(attachment)} />
    </div>
  );
}

// a shell command shows as typed, not as escaped JSON, so it's easy to check before allowing it
const prettyArgs = (args: string) => {
  try {
    const parsed = JSON.parse(args || "{}");
    if (typeof parsed?.command === "string" && Object.keys(parsed).length === 1) return parsed.command;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return args;
  }
};

function ToolCallView({ call, waiting, streaming }: { call: ToolCall; waiting: boolean; streaming: boolean }) {
  return (
    <details className="tool-call">
      <summary>
        {waiting ? "Waiting to run" : call.result !== undefined ? "Used" : streaming ? "Running" : "Didn't run"} <code>{call.name}</code>
      </summary>
      <pre>{prettyArgs(call.args)}</pre>
      {call.result !== undefined && <pre>{call.result}</pre>}
    </details>
  );
}
