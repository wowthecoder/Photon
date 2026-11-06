import type { Chat } from "./store";
import { ConfirmButton } from "./ConfirmButton";
import { ModelsIcon, NewChatIcon, SettingsIcon, SidebarIcon, TrashIcon } from "./icons";

type Props = {
  chats: Chat[];
  activeId: string | null;
  modelsOpen: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onModels: () => void;
  onSettings: () => void;
  onCollapse: () => void;
};

export function Sidebar({ chats, activeId, modelsOpen, onSelect, onNew, onDelete, onModels, onSettings, onCollapse }: Props) {
  return (
    <aside className="sidebar">
      <div className="titlebar">
        <button className="icon-btn" onClick={onCollapse} title="Hide sidebar (⌘B)"><SidebarIcon /></button>
        <button className="icon-btn" onClick={onNew} title="New chat (⌘N)"><NewChatIcon /></button>
      </div>
      <button className={`nav-item ${modelsOpen ? "active" : ""}`} onClick={onModels}>
        <ModelsIcon /> Models
      </button>
      <nav className="chat-list">
        {chats.length === 0 && <p className="muted">No chats yet</p>}
        {chats.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className={`chat-item ${!modelsOpen && c.id === activeId ? "active" : ""}`}
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
