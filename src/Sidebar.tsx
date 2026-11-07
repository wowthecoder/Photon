import type { Chat, View } from "./store";
import { ConfirmButton } from "./ConfirmButton";
import { ConnectorsIcon, ImageIcon, ModelsIcon, NewChatIcon, SettingsIcon, SidebarIcon, TrashIcon } from "./icons";

type Props = {
  chats: Chat[];
  activeId: string | null;
  view: View;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onModels: () => void;
  onImages: () => void;
  onConnectors: () => void;
  onSettings: () => void;
  onCollapse: () => void;
};

export function Sidebar({ chats, activeId, view, onSelect, onNew, onDelete, onModels, onImages, onConnectors, onSettings, onCollapse }: Props) {
  return (
    <aside className="sidebar">
      <div className="titlebar">
        <button className="icon-btn" onClick={onCollapse} title="Hide sidebar (⌘B)"><SidebarIcon /></button>
        <button className="icon-btn" onClick={onNew} title="New chat (⌘N)"><NewChatIcon /></button>
      </div>
      <button className={`nav-item ${view === "images" ? "active" : ""}`} onClick={onImages}>
        <ImageIcon /> Images
      </button>
      <button className={`nav-item ${view === "models" ? "active" : ""}`} onClick={onModels}>
        <ModelsIcon /> Models
      </button>
      <button className={`nav-item ${view === "connectors" ? "active" : ""}`} onClick={onConnectors}>
        <ConnectorsIcon /> Connectors
      </button>
      <nav className="chat-list">
        {chats.length === 0 && <p className="muted">No chats yet</p>}
        {chats.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className={`chat-item ${view === "chat" && c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
          >
            <span className="chat-title">{c.title}</span>
            <ConfirmButton className="hover-only" title="Delete chat" onConfirm={() => onDelete(c.id)}>
              <TrashIcon />
            </ConfirmButton>
          </div>
        ))}
      </nav>
      <button className="nav-item footer" onClick={onSettings}>
        <SettingsIcon /> Settings
      </button>
    </aside>
  );
}
