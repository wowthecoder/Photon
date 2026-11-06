import { useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { unloadImageModel, type GeneratedImage } from "./diffusion";
import { Images } from "./Images";
import { Models, type ModelKind, type ModelTab } from "./Models";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { isReady, streamChat } from "./llm";
import { usePersistent, type Chat as ChatT, type Message, type Settings as SettingsT, type View } from "./store";
import { useEngine } from "./useEngine";

const DEFAULT_SETTINGS: SettingsT = { model: "", systemPrompt: "", temperature: 0.7, theme: "system" };

export function App() {
  const [chats, setChats] = usePersistent<ChatT[]>("chats", []);
  const [settings, setSettings] = usePersistent("settings", DEFAULT_SETTINGS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [gallery, setGallery] = usePersistent<GeneratedImage[]>("images", []);
  const [view, setView] = useState<View>("chat");
  // each model kind remembers its own Downloaded/Discover tab
  const [modelsNav, setModelsNav] = useState<{ kind: ModelKind; tabs: Record<ModelKind, ModelTab> }>({ kind: "text", tabs: { text: "downloaded", image: "downloaded" } });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { engine, models, progress, info, refresh, diffusion, imageModels } = useEngine();
  const ready = models.filter(isReady);
  const active = chats.find((c) => c.id === activeId);
  const defaultModel = ready.some((m) => m.id === settings.model) ? settings.model : (ready[0]?.id ?? "");
  // a chat's saved model may have been deleted since; fall back to the default instead of offering a model that isn't there
  const model = ready.some((m) => m.id === active?.model) ? active!.model : defaultModel;

  const update = (id: string, fn: (c: ChatT) => ChatT) => setChats((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
  const openChat = (id: string | null) => (setActiveId(id), setView("chat"));
  const navigateModels = (kind: ModelKind, tab?: ModelTab) => setModelsNav((n) => ({ kind, tabs: tab ? { ...n.tabs, [kind]: tab } : n.tabs }));
  const openModels = (kind?: ModelKind, tab?: ModelTab) => (kind && navigateModels(kind, tab), setView("models"));

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
      // free the image model first: a chat model and an image model may not both fit in memory
      if (diffusion.status === "ready") await unloadImageModel(diffusion).catch(() => {});
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
          view={view}
          onSelect={openChat}
          onNew={() => openChat(null)}
          onDelete={remove}
          onModels={() => openModels()}
          onImages={() => setView("images")}
          onSettings={() => setSettingsOpen(true)}
          onCollapse={() => setSidebarOpen(false)}
        />
      )}
      <Images
        hidden={view !== "images"}
        diffusion={diffusion}
        engine={engine}
        models={models}
        imageModels={imageModels}
        gallery={gallery}
        setGallery={setGallery}
        sidebarOpen={sidebarOpen}
        onExpand={() => setSidebarOpen(true)}
        onOpenModels={() => openModels("image", "discover")}
      />
      {view === "images" ? null : view === "models" ? (
        <Models
          engine={engine}
          models={models}
          imageModels={imageModels}
          progress={progress}
          info={info}
          kind={modelsNav.kind}
          tab={modelsNav.tabs[modelsNav.kind]}
          onNavigate={navigateModels}
          sidebarOpen={sidebarOpen}
          onExpand={() => setSidebarOpen(true)}
          refresh={refresh}
        />
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
          onOpenModels={() => openModels("text", "discover")}
        />
      )}
      <Settings open={settingsOpen} settings={settings} models={ready} info={info} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
