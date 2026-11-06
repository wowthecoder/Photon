import { useEffect, useState } from "react";
import { ConfirmButton } from "./ConfirmButton";
import { PUBLISHERS, fits, formatBytes, listQuants, searchRepos, type Quant, type Repo } from "./catalog";
import { deleteModel, downloadModel, modelLabel, pauseDownload, sumProgress, type LocalModel, type Progress } from "./llm";
import { SidebarIcon, TrashIcon } from "./icons";

type Props = {
  engine: EngineState;
  models: LocalModel[];
  progress: Record<string, Progress>;
  info: SystemInfo | null;
  sidebarOpen: boolean;
  onExpand: () => void;
  refresh: () => void;
};

const STATUS: Record<string, string> = {
  unloaded: "Ready",
  sleeping: "Ready",
  loaded: "In memory",
  loading: "Loading…",
  incomplete: "Paused",
};

export function Models(props: Props) {
  const [tab, setTab] = useState<"downloaded" | "discover">("downloaded");
  const [error, setError] = useState("");
  const run = (p: Promise<unknown>) => p.then(props.refresh, (e) => setError(e.message));

  return (
    <main className="chat">
      <header className={`titlebar ${props.sidebarOpen ? "" : "inset"}`}>
        {!props.sidebarOpen && <button className="icon-btn" onClick={props.onExpand} title="Show sidebar (⌘B)"><SidebarIcon /></button>}
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "downloaded"} onClick={() => setTab("downloaded")}>Downloaded</button>
          <button role="tab" aria-selected={tab === "discover"} onClick={() => setTab("discover")}>Discover</button>
        </div>
      </header>
      <div className="page">
        {props.engine.status === "error" && (
          <div className="banner">
            {props.engine.error} <button className="link-btn" onClick={() => window.photon?.restartEngine()}>Restart engine</button>
          </div>
        )}
        {error && <div className="banner" onClick={() => setError("")}>{error}</div>}
        {tab === "downloaded" ? <Downloaded {...props} run={run} onDiscover={() => setTab("discover")} /> : <Discover {...props} run={run} />}
      </div>
    </main>
  );
}

type TabProps = Props & { run: (p: Promise<unknown>) => void };

function Downloaded({ engine, models, progress, info, run, onDiscover }: TabProps & { onDiscover: () => void }) {
  return (
    <>
      {info && (
        <p className="muted">
          {formatBytes(info.usedBytes)} used · {formatBytes(info.freeBytes)} free in{" "}
          <button className="link-btn" onClick={() => window.photon?.revealModelsDir()}>{info.modelsDir}</button>
        </p>
      )}
      {models.length === 0 && (
        <div className="empty-card">
          <p>No models downloaded yet.</p>
          <button className="primary-btn" onClick={onDiscover}>Browse models</button>
        </div>
      )}
      {models.map((m) => {
        const p = progress[m.id] ?? sumProgress(m.status.progress);
        const downloading = m.status.value === "downloading";
        return (
          <div key={m.id} className="row">
            <div className="row-main">
              <div className="row-title">{modelLabel(m.id)}</div>
              <div className="muted small">{m.id.split(":")[0]}</div>
              {downloading && <ProgressBar {...p} />}
            </div>
            <span className="muted small">{downloading ? percent(p) : STATUS[m.status.value] ?? m.status.value}</span>
            {downloading && <button className="secondary-btn" onClick={() => run(pauseDownload(engine, m.id))}>Pause</button>}
            {m.status.value === "incomplete" && <button className="secondary-btn" onClick={() => run(downloadModel(engine, m.id))}>Resume</button>}
            {!downloading && (
              <ConfirmButton title="Delete model" onConfirm={() => run(deleteModel(engine, m.id))}>
                <TrashIcon />
              </ConfirmButton>
            )}
          </div>
        );
      })}
    </>
  );
}

function Discover({ engine, models, progress, info, run }: TabProps) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<string | undefined>(PUBLISHERS[0]);
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRepos(null);
    setError("");
    searchRepos(query, author).then((r) => live && setRepos(r), (e) => live && setError(e.message));
    return () => void (live = false);
  }, [query, author]);

  return (
    <>
      <form className="search" onSubmit={(e) => (e.preventDefault(), setQuery(draft.trim()))}>
        <input type="search" placeholder="Search GGUF models on Hugging Face" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      <div className="chips">
        {[...PUBLISHERS, undefined].map((a) => (
          <button key={a ?? "all"} className={`chip ${author === a ? "active" : ""}`} onClick={() => setAuthor(a)}>
            {a ?? "Everyone"}
          </button>
        ))}
      </div>
      {author === undefined && <p className="muted small">Community uploads are unreviewed. Prefer the publishers above when you can.</p>}
      {error && <p className="banner">{error}</p>}
      {!repos && !error && <p className="muted">Loading…</p>}
      {repos?.length === 0 && <p className="muted">No GGUF models found.</p>}
      {repos?.map((r) => (
        <div key={r.id} className="repo">
          <button className="row row-btn" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <div className="row-main">
              <div className="row-title">{r.id.split("/")[1].replace(/-GGUF$/i, "")}</div>
              <div className="muted small">{r.id.split("/")[0]} · {r.downloads.toLocaleString()} downloads</div>
            </div>
            {r.gated && <span className="badge">Gated</span>}
            <span className="muted">{open === r.id ? "▾" : "▸"}</span>
          </button>
          {open === r.id && <Quants repo={r} engine={engine} models={models} progress={progress} info={info} run={run} />}
        </div>
      ))}
    </>
  );
}

type QuantsProps = Pick<TabProps, "engine" | "models" | "progress" | "info" | "run"> & { repo: Repo };

function Quants({ repo, engine, models, progress, info, run }: QuantsProps) {
  const [quants, setQuants] = useState<Quant[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listQuants(repo.id).then(setQuants, (e) => setError(e.message));
  }, [repo.id]);

  if (error) return <p className="banner">{error}</p>;
  if (!quants) return <p className="muted quant">Loading files…</p>;
  if (quants.length === 0) return <p className="muted quant">No downloadable GGUF files.</p>;

  return quants.map((q) => {
    const id = `${repo.id}:${q.tag}`;
    const local = models.find((m) => m.id.toUpperCase() === id.toUpperCase());
    const tooBig = info && !fits(q.size, info.totalMem);
    const noSpace = info && q.size > info.freeBytes;
    const p = progress[id] ?? (local && sumProgress(local.status.progress));
    return (
      <div key={q.tag} className="row quant">
        <div className="row-main">
          <div className="row-title">{q.tag}</div>
          {local?.status.value === "downloading" && p && <ProgressBar {...p} />}
        </div>
        <span className="muted small">{formatBytes(q.size)}</span>
        {info && <span className={`badge ${tooBig ? "warn" : "ok"}`}>{tooBig ? "Too large for this Mac" : "Fits"}</span>}
        {local ? (
          <span className="muted small status">{local.status.value === "downloading" && p ? percent(p) : local.status.value === "incomplete" ? "Paused" : "Downloaded"}</span>
        ) : (
          <button
            className="secondary-btn"
            disabled={!!repo.gated || !!noSpace || engine.status !== "ready"}
            title={repo.gated ? "This model requires accepting a license on Hugging Face" : noSpace ? "Not enough disk space" : undefined}
            onClick={() => run(downloadModel(engine, id))}
          >
            Download
          </button>
        )}
      </div>
    );
  });
}

const percent = (p: Progress) => (p.total ? `${Math.floor((p.done / p.total) * 100)}%` : "Starting…");

const ProgressBar = (p: Progress) => <progress className="progress" value={p.done} max={p.total || 1} />;
