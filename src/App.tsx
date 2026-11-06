import { useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { Models } from "./Models";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { isReady, streamChat } from "./llm";
import { usePersistent, type Chat as ChatT, type Message, type Settings as SettingsT } from "./store";
import { useEngine } from "./useEngine";

const DEFAULT_SETTINGS: SettingsT = { model: "", systemPrompt: "", temperature: 0.7, theme: "system" };

export function App() {
  const [chats, setChats] = usePersistent<ChatT[]>("chats", []);
  const [settings, setSettings] = usePersistent("settings", DEFAULT_SETTINGS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "models">("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { engine, models, progress, info, refresh } = useEngine();
  const ready = models.filter(isReady);
  const active = chats.find((c) => c.id === activeId);
  const defaultModel = ready.some((m) => m.id === settings.model) ? settings.model : (ready[0]?.id ?? "");
  // a chat's saved model may have been deleted since; fall back to the default instead of offering a model that isn't there
  const model = ready.some((m) => m.id === active?.model) ? active!.model : defaultModel;

  const update = (id: string, fn: (c: ChatT) => ChatT) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const openChat = (id: string | null) => (setActiveId(id), setView("chat"));

  useEffect(() => {
    if (settings.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const action = { n: () => openChat(null), b: () => setSidebarOpen((o) => !o), ",": () => setSettingsOpen(true) }[e.key];
      if (action) (e.preventDefault(), action());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string) {
    const chat = { ...(active ?? { id: crypto.randomUUID(), title: text.slice(0, 48), messages: [] }), model };
    const history: Message[] = [...chat.messages, { id: crypto.randomUUID(), role: "user", content: text }];
    const replyId = crypto.randomUUID();
    setChats((cs) => [{ ...chat, messages: [...history, { id: replyId, role: "assistant", content: "" }] }, ...cs.filter((c) => c.id !== chat.id)]);
    setActiveId(chat.id);

    const append = (content: string, reasoning = "") =>
      update(chat.id, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === replyId ? { ...m, content: m.content + content, reasoning: (m.reasoning ?? "") + reasoning || undefined } : m)),
      }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    try {
      for await (const t of streamChat(engine, history, chat.model, settings, ctrl.signal)) append(t.content, t.reasoning);
    } catch (e) {
      if (!ctrl.signal.aborted) append(`\n\n**Error:** ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function remove(id: string) {
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  }

  return (
    <div className="app">
      {sidebarOpen && (
        <Sidebar
          chats={chats}
          activeId={activeId}
          modelsOpen={view === "models"}
          onSelect={openChat}
          onNew={() => openChat(null)}
          onDelete={remove}
          onModels={() => setView("models")}
          onSettings={() => setSettingsOpen(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}
      {view === "models" ? (
        <Models engine={engine} models={models} progress={progress} info={info} sidebarOpen={sidebarOpen} onExpand={() => setSidebarOpen(true)} refresh={refresh} />
      ) : (
        <Chat
          chat={active}
          model={model}
          models={ready}
          engine={engine}
          streaming={streaming}
          sidebarOpen={sidebarOpen}
          onModelChange={(model) => (active ? update(active.id, (c) => ({ ...c, model })) : setSettings({ ...settings, model }))}
          onSend={send}
          onStop={() => abortRef.current?.abort()}
          onNew={() => openChat(null)}
          onExpand={() => setSidebarOpen(true)}
          onOpenModels={() => setView("models")}
        />
      )}
      <Settings open={settingsOpen} settings={settings} models={ready} info={info} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
