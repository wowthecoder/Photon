import { useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { MODELS, streamChat } from "./llm";
import { usePersistent, type Chat as ChatT, type Message, type Settings as SettingsT } from "./store";

const DEFAULT_SETTINGS: SettingsT = { model: MODELS[0], systemPrompt: "", temperature: 0.7, theme: "system" };

export function App() {
  const [chats, setChats] = usePersistent<ChatT[]>("chats", []);
  const [settings, setSettings] = usePersistent("settings", DEFAULT_SETTINGS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const active = chats.find((c) => c.id === activeId);

  const update = (id: string, fn: (c: ChatT) => ChatT) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  useEffect(() => {
    if (settings.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      const action = { n: () => setActiveId(null), b: () => setSidebarOpen((o) => !o), ",": () => setSettingsOpen(true) }[e.key];
      if (action) (e.preventDefault(), action());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function send(text: string) {
    const chat = active ?? { id: crypto.randomUUID(), title: text.slice(0, 48), model: settings.model, messages: [] };
    const history: Message[] = [...chat.messages, { id: crypto.randomUUID(), role: "user", content: text }];
    const replyId = crypto.randomUUID();
    setChats((cs) => [{ ...chat, messages: [...history, { id: replyId, role: "assistant", content: "" }] }, ...cs.filter((c) => c.id !== chat.id)]);
    setActiveId(chat.id);

    const appendReply = (token: string) =>
      update(chat.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === replyId ? { ...m, content: m.content + token } : m)) }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    try {
      for await (const token of streamChat(history, chat.model, settings, ctrl.signal)) appendReply(token);
    } catch (e) {
      appendReply(`\n\n**Error:** ${e instanceof Error ? e.message : String(e)}`);
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
          onSelect={setActiveId}
          onNew={() => setActiveId(null)}
          onDelete={remove}
          onSettings={() => setSettingsOpen(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}
      <Chat
        chat={active}
        model={active?.model ?? settings.model}
        streaming={streaming}
        sidebarOpen={sidebarOpen}
        onModelChange={(model) => (active ? update(active.id, (c) => ({ ...c, model })) : setSettings({ ...settings, model }))}
        onSend={send}
        onStop={() => abortRef.current?.abort()}
        onNew={() => setActiveId(null)}
        onExpand={() => setSidebarOpen(true)}
      />
      <Settings open={settingsOpen} settings={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
