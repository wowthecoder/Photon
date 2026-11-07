import { useEffect, useRef, useState } from "react";
import type { Settings as SettingsT, Theme } from "./store";
import { modelLabel, type LocalModel } from "./llm";
import { formatBytes } from "./catalog";

type Props = {
  open: boolean;
  settings: SettingsT;
  models: LocalModel[];
  info: SystemInfo | null;
  onChange: (s: SettingsT) => void;
  onClose: () => void;
};

export function Settings({ open, settings, models, info, onChange, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) => onChange({ ...settings, [key]: value });

  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);

  return (
    <dialog ref={ref} className="settings" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="settings-body">
        <h2>Settings</h2>
        <label>
          Default model
          <select value={settings.model} onChange={(e) => set("model", e.target.value)} disabled={models.length === 0}>
            {models.length === 0 && <option value="">No models downloaded</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{modelLabel(m.id)}</option>)}
          </select>
        </label>
        <div className="field">
          Models folder
          <div className="folder">
            <span className="folder-path" title={info?.modelsDir}>{info?.modelsDir ?? "…"}</span>
            <button className="secondary-btn" onClick={() => window.photon?.revealModelsDir()}>Show in Finder</button>
            <button className="secondary-btn" onClick={() => window.photon?.chooseModelsDir()}>Change…</button>
          </div>
          {info && <span className="muted small">{formatBytes(info.usedBytes)} used · {formatBytes(info.freeBytes)} free. Changing the folder doesn't move existing models.</span>}
        </div>
        <Connectors />
        <label>
          System prompt
          <textarea rows={4} value={settings.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
        </label>
        <label>
          <span>Temperature <span className="muted">{settings.temperature.toFixed(1)}</span></span>
          <input type="range" min={0} max={2} step={0.1} value={settings.temperature} onChange={(e) => set("temperature", +e.target.value)} />
        </label>
        <label>
          Appearance
          <select value={settings.theme} onChange={(e) => set("theme", e.target.value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <div className="dialog-actions">
          <button className="primary-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </dialog>
  );
}

function Connectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  useEffect(() => {
    if (!window.photon) return;
    window.photon.connectors().then(setConnectors);
    return window.photon.onConnectors(setConnectors);
  }, []);
  if (!connectors.length) return null;
  return (
    <div className="field">
      Connectors
      {connectors.map((c) => <ConnectorRow key={c.id} connector={c} />)}
      <span className="muted small">Models that support tools can use connected accounts. Photon asks before running a tool that can change data.</span>
    </div>
  );
}

function ConnectorRow({ connector: c }: { connector: Connector }) {
  const [token, setToken] = useState("");
  const connect = () => window.photon!.connect(c.id, token).then(() => setToken(""));
  return (
    <div className="connector">
      <div className="folder">
        <span className="connector-name">{c.name}</span>
        <span className="folder-path">{c.status === "on" ? `Connected · ${c.toolCount} ${c.toolCount === 1 ? "tool" : "tools"}` : c.status === "connecting" ? "Connecting…" : "Not connected"}</span>
        {c.status === "on" && <button className="secondary-btn" onClick={() => window.photon!.disconnect(c.id)}>Disconnect</button>}
      </div>
      {c.status !== "on" && (
        <form className="folder" onSubmit={(e) => (e.preventDefault(), connect())}>
          <input type="password" placeholder="Personal access token" value={token} onChange={(e) => setToken(e.target.value)} disabled={c.status === "connecting"} aria-label={`${c.name} token`} />
          <button className="secondary-btn" disabled={!token.trim() || c.status === "connecting"}>Connect</button>
        </form>
      )}
      {c.status !== "on" && (
        <span className="muted small">
          <a href={c.tokenUrl} target="_blank" rel="noreferrer">Create a token</a> with access to the repositories you want Photon to use.
        </span>
      )}
      {c.error && <span className="small warn-text">{c.error}</span>}
    </div>
  );
}
