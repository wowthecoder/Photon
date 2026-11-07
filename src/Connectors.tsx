import { useEffect, useState } from "react";
import { SidebarIcon } from "./icons";

type Props = { sidebarOpen: boolean; onExpand: () => void };

const STATUS: Record<Connector["status"], string> = { off: "Not connected", connecting: "Waiting for you to approve in your browser…", on: "Connected", error: "Not connected" };

export function Connectors({ sidebarOpen, onExpand }: Props) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  useEffect(() => {
    if (!window.photon) return;
    window.photon.connectors().then(setConnectors);
    return window.photon.onConnectors(setConnectors);
  }, []);

  return (
    <main className="chat">
      <header className={`titlebar ${sidebarOpen ? "" : "inset"}`}>
        {!sidebarOpen && <button className="icon-btn" onClick={onExpand} title="Show sidebar (⌘B)"><SidebarIcon /></button>}
        <div className="chat-heading">Connectors</div>
      </header>
      <div className="page">
        <p className="muted">Let models that support tools use your accounts. Photon asks before running anything that can change data.</p>
        {!window.photon && <div className="empty-card"><p>Connectors only work in the desktop app.</p></div>}
        {connectors.map((c) => (
          <div key={c.id} className="row">
            <div className="row-main">
              <div className="row-title">
                {c.name} {c.status === "on" && <span className="badge ok">{c.toolCount} {c.toolCount === 1 ? "tool" : "tools"}</span>}
              </div>
              <div className="muted small">{c.status === "off" ? c.description : STATUS[c.status]}</div>
              {c.error && <div className="small warn-text">{c.error}</div>}
              {!c.setUp && <div className="small warn-text">Needs an OAuth app in electron/oauth-clients.json. See Connectors in the README.</div>}
            </div>
            {c.status === "on" ? (
              <button className="secondary-btn" onClick={() => window.photon!.disconnect(c.id)}>Disconnect</button>
            ) : c.status === "connecting" ? (
              <button className="secondary-btn" onClick={() => window.photon!.disconnect(c.id)}>Cancel</button>
            ) : (
              <button className="primary-btn" disabled={!c.setUp} title={c.setUp ? undefined : "Add an OAuth app for this connector first"} onClick={() => window.photon!.connect(c.id)}>
                Connect
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
