import { useEffect, useRef, useState } from "react";
import { Chat } from "./Chat";
import { Connectors } from "./Connectors";
import { unloadImageModel, type GeneratedImage } from "./diffusion";
import { Images } from "./Images";
import { Models, type ModelKind, type ModelTab } from "./Models";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { inputsOf, isReady, streamChat } from "./llm";
import { usePersistent, type Attachment, type Chat as ChatT, type Message, type Approval, type Settings as SettingsT, type ToolCall, type View } from "./store";
import { useEngine } from "./useEngine";

// after this many tool rounds the model has to answer without tools
const MAX_TOOL_ROUNDS = 20;

// null when the model wrote arguments that aren't a JSON object
const parseArgs = (args: string): object | null => {
  try {
    const parsed = JSON.parse(args || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const WEB_TOOLS = ["web_search", "web_fetch"];

// without the second sentence, models retry the same thing with other tools, and the user gets one prompt after another
const DECLINED = "The user declined to run this tool. Don't retry it or try to do the same thing another way: answer with what you have, or say what you'd need.";

// web_fetch runs without asking when its address is already in the chat: typed by the user or returned by a tool
// (e.g. a search result). Otherwise a page could get the model to send what's in the chat to another site in an address.
const inChat = (call: ToolCall, messages: Message[]) => {
  const url = (parseArgs(call.args) as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.length > 0 && messages.some((m) => (m.role === "user" && m.content.includes(url)) || m.toolCalls?.some((c) => c.result?.includes(url)));
};

// file tools run without asking when their path is in the workspace folder; the main process resolves it
const inWorkspace = async (tool: McpTool, call: ToolCall) => {
  const path = (parseArgs(call.args) as { path?: unknown } | null)?.path;
  return !!tool.askOutsideWorkspace && typeof path === "string" && !!(await window.photon?.inWorkspace(path).catch(() => false));
};

// runs a tool; Stop cancels it (bash kills its command)
async function runTool(call: ToolCall, signal: AbortSignal) {
  const args = parseArgs(call.args);
  if (!args) return "Error: the arguments aren't a valid JSON object.";
  const cancel = () => window.photon!.cancelTool(call.id);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    return await window.photon!.callTool(call.name, args, call.id);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

const DEFAULT_SETTINGS: SettingsT = { model: "", systemPrompt: "", temperature: 0.7, theme: "system", shell: true, web: true, disabledConnectors: [] };

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
  const [approval, setApproval] = useState<Approval | null>(null);
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

  async function send(text: string, attachments: Attachment[] = []) {
    const chat = { ...(active ?? { id: crypto.randomUUID(), title: (text || attachments[0]?.label || "New chat").slice(0, 48), messages: [] }), model };
    const history: Message[] = [...chat.messages, { id: crypto.randomUUID(), role: "user", content: text, ...(attachments.length ? { attachments } : {}) }];
    setChats((cs) => [{ ...chat, messages: history }, ...cs.filter((c) => c.id !== chat.id)]);
    setActiveId(chat.id);

    const patch = (id: string, fn: (m: Message) => Message) => update(chat.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) }));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    const ask = (call: ToolCall, warning?: string) =>
      new Promise<boolean>((resolve) => {
        const done = (ok: boolean) => (setApproval(null), resolve(ok));
        ctrl.signal.addEventListener("abort", () => done(false), { once: true });
        setApproval({ chatId: chat.id, call, warning, resolve: done });
      });

    let reply: Message = { id: crypto.randomUUID(), role: "assistant", content: "" };
    try {
      // free the image model first: a chat model and an image model may not both fit in memory
      if (diffusion.status === "ready") await unloadImageModel(diffusion).catch(() => {});
      const tools = ((await window.photon?.tools().catch(() => [])) ?? []).filter(
        (t) => (settings.shell || t.name !== "bash") && (settings.web || !WEB_TOOLS.includes(t.name)) && !(t.connector && settings.disabledConnectors.includes(t.connector)),
      );
      for (let round = 0; ; round++) {
        reply = { id: crypto.randomUUID(), role: "assistant", content: "" };
        update(chat.id, (c) => ({ ...c, messages: [...c.messages, reply] }));
        let calls: ToolCall[] = [];
        for await (const t of streamChat(engine, history, chat.model, settings, ctrl.signal, inputsOf(ready.find((m) => m.id === chat.model)), round < MAX_TOOL_ROUNDS ? tools : [])) {
          if (t.toolCalls) {
            calls = t.toolCalls;
            continue;
          }
          reply = { ...reply, content: reply.content + t.content, reasoning: (reply.reasoning ?? "") + t.reasoning || undefined };
          const { content, reasoning } = reply;
          patch(reply.id, (m) => ({ ...m, content, reasoning }));
        }
        if (!calls.length) break;
        for (const call of calls) {
          const tool = tools.find((t) => t.name === call.name);
          reply = { ...reply, toolCalls: [...(reply.toolCalls ?? []), call] };
          const { toolCalls } = reply;
          patch(reply.id, (m) => ({ ...m, toolCalls }));
          const ok = !!tool && (tool.readOnly || (call.name === "web_fetch" && inChat(call, [...history, reply])) || (await inWorkspace(tool, call)) || (await ask(call, tool.warning)));
          if (ctrl.signal.aborted) throw new Error("Stopped");
          const result = !tool ? `Error: there is no tool called ${call.name}.` : ok ? await runTool(call, ctrl.signal) : DECLINED;
          reply = { ...reply, toolCalls: reply.toolCalls!.map((c) => (c.id === call.id ? { ...c, result } : c)) };
          const done = reply.toolCalls;
          patch(reply.id, (m) => ({ ...m, toolCalls: done }));
          // keep what a stopped command printed, but don't start another round
          if (ctrl.signal.aborted) throw new Error("Stopped");
        }
        history.push(reply);
      }
    } catch (e) {
      if (!ctrl.signal.aborted) patch(reply.id, (m) => ({ ...m, content: m.content + `\n\n**Error:** ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function remove(id: string) {
    const names = chats.find((c) => c.id === id)?.messages.flatMap((m) => m.attachments?.map((a) => a.name) ?? []) ?? [];
    if (names.length) window.photon?.deleteAttachments(names);
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
          onConnectors={() => setView("connectors")}
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
      {view === "images" ? null : view === "connectors" ? (
        <Connectors sidebarOpen={sidebarOpen} onExpand={() => setSidebarOpen(true)} />
      ) : view === "models" ? (
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
          approval={approval?.chatId === active?.id ? approval : null}
          web={settings.web}
          onWebChange={(web) => setSettings({ ...settings, web })}
          disabledConnectors={settings.disabledConnectors}
          onConnectorChange={(id, on) => setSettings({ ...settings, disabledConnectors: on ? settings.disabledConnectors.filter((c) => c !== id) : [...settings.disabledConnectors, id] })}
          onOpenConnectors={() => setView("connectors")}
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
