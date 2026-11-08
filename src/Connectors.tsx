import { useEffect, useState } from "react";
import { CheckIcon, PlusIcon, SidebarIcon } from "./icons";

// src/connector-icons/<connector id>.svg
const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("./connector-icons/*.svg", { eager: true, query: "?url", import: "default" })).map(([file, url]) => [file.split("/").pop()!.replace(".svg", ""), url]),
);

type Props = { sidebarOpen: boolean; onExpand: () => void };

export function Connectors({ sidebarOpen, onExpand }: Props) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!window.photon) return;
    window.photon.connectors().then(setConnectors);
    return window.photon.onConnectors(setConnectors);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = connectors.filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q));
  const connected = shown.filter((c) => c.status === "on");
  const available = shown.filter((c) => c.status !== "on");

  return (
    <main className="chat">
      <header className={`titlebar ${sidebarOpen ? "" : "inset"}`}>
        {!sidebarOpen && <button className="icon-btn" onClick={onExpand} title="Show sidebar (⌘B)"><SidebarIcon /></button>}
      </header>
      <div className="page connectors">
        <div className="connectors-head">
          <div>
            <h1>Connectors</h1>
            <p className="muted">Let models use your accounts. Photon asks before running anything that can change data.</p>
          </div>
          <div className="search">
            <input type="search" placeholder="Search connectors" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search connectors" />
          </div>
        </div>
        {!window.photon && <div className="empty-card"><p>Connectors only work in the desktop app.</p></div>}
        {window.photon && !shown.length && <p className="muted">No connectors match “{query.trim()}”.</p>}
        <Section title="Connected" connectors={connected} />
        <Section title={connected.length ? "More connectors" : "Available"} connectors={available} />
      </div>
    </main>
  );
}

function Section({ title, connectors }: { title: string; connectors: Connector[] }) {
  if (!connectors.length) return null;
  return (
    <section>
      <h2>{title}</h2>
      <div className="connector-grid">{connectors.map((c) => <ConnectorCard key={c.id} connector={c} />)}</div>
    </section>
  );
}

function ConnectorCard({ connector: c }: { connector: Connector }) {
  const detail =
    c.status === "on" ? `Connected · ${c.toolCount} ${c.toolCount === 1 ? "tool" : "tools"}`
    : c.status === "connecting" ? "Approve Photon in your browser…"
    : c.description;
  const problem = c.error ?? (c.setUp ? "" : "Needs an OAuth app. See Connectors setup in the README.");
  return (
    <div className="connector">
      <div className="connector-icon">{ICONS[c.id] ? <img src={ICONS[c.id]} alt="" /> : <span>{c.name[0]}</span>}</div>
      <div className="row-main">
        <div className="row-title">{c.name}</div>
        <div className="muted small connector-detail" title={detail}>{detail}</div>
        {problem && <div className="small warn-text connector-detail" title={problem}>{problem}</div>}
      </div>
      {c.status === "on" ? (
        <button className="icon-btn connector-action done" onClick={() => window.photon!.disconnect(c.id)} title={`Disconnect ${c.name}`} aria-label={`Disconnect ${c.name}`}>
          <CheckIcon />
        </button>
      ) : c.status === "connecting" ? (
        <button className="secondary-btn" onClick={() => window.photon!.disconnect(c.id)}>Cancel</button>
      ) : (
        <button className="icon-btn connector-action" disabled={!c.setUp} onClick={() => window.photon!.connect(c.id)} title={`Connect ${c.name}`} aria-label={`Connect ${c.name}`}>
          <PlusIcon />
        </button>
      )}
    </div>
  );
}
