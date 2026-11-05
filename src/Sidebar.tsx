import { useState } from "react";
import type { Chat } from "./store";
import { NewChatIcon, SettingsIcon, SidebarIcon, TrashIcon } from "./icons";

type Props = {
  chats: Chat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
  onCollapse: () => void;
};

export function Sidebar({ chats, activeId, onSelect, onNew, onDelete, onSettings, onCollapse }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <aside className="sidebar">
      <div className="titlebar">
        <button className="icon-btn" onClick={onCollapse} title="Hide sidebar (⌘B)"><SidebarIcon /></button>
        <button className="icon-btn" onClick={onNew} title="New chat (⌘N)"><NewChatIcon /></button>
      </div>
      <nav className="chat-list">
        {chats.length === 0 && <p className="muted">No chats yet</p>}
        {chats.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            className={`chat-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}
          >
            <span className="chat-title">{c.title}</span>
            {confirmId === c.id ? (
              <button className="danger-btn" onClick={(e) => (e.stopPropagation(), onDelete(c.id))} onBlur={() => setConfirmId(null)} autoFocus>
                Delete
              </button>
            ) : (
              <button className="icon-btn hover-only" title="Delete chat" onClick={(e) => (e.stopPropagation(), setConfirmId(c.id))}>
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
      </nav>
      <button className="sidebar-footer" onClick={onSettings}>
        <SettingsIcon /> Settings
      </button>
    </aside>
  );
}
