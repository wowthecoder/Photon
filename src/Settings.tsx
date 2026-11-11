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
  // the SearXNG address lives in the main process, which does the searching
  const [savedUrl, setSavedUrl] = useState("");
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const saveUrl = (u: string) =>
    window.photon?.setSearchUrl(u).then(
      () => window.photon!.searchUrl().then((s) => (setSavedUrl(s), setUrl(s), setUrlError(""))),
      (e: Error) => setUrlError(e.message.replace(/^.*Error: /, "")),
    );

  useEffect(() => {
    if (open) ref.current?.showModal(), window.photon?.searchUrl().then((s) => (setSavedUrl(s), setUrl(s)));
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
        <label>
          System prompt
          <textarea rows={4} value={settings.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} />
        </label>
        <label>
          <span>Temperature <span className="muted">{settings.temperature.toFixed(1)}</span></span>
          <input type="range" min={0} max={2} step={0.1} value={settings.temperature} onChange={(e) => set("temperature", +e.target.value)} />
        </label>
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={settings.shell} onChange={(e) => set("shell", e.target.checked)} />
            Let models run shell commands
          </label>
          <span className="muted small">Photon asks before running each one. Commands start in Photon's workspace folder but can reach your whole Mac.</span>
        </div>
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={settings.web} onChange={(e) => set("web", e.target.checked)} />
            Let models search and read the web
          </label>
          <span className="muted small">Searches go to your SearXNG, and pages are loaded from their websites. Photon asks before opening an address that isn't already in the chat.</span>
          {settings.web && (
            <div className="folder">
              <input type="url" placeholder="SearXNG address, e.g. http://127.0.0.1:8888" value={url} onChange={(e) => setUrl(e.target.value)} />
              <button className="secondary-btn" disabled={url.trim().replace(/\/+$/, "") === savedUrl} onClick={() => saveUrl(url)}>Save</button>
            </div>
          )}
          {settings.web && (urlError || !savedUrl) && (
            <span className="muted small">{urlError || "Without a SearXNG address, models can read pages but not search. The README shows how to run SearXNG on your Mac."}</span>
          )}
        </div>
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

