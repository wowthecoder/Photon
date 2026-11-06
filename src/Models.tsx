import { useEffect, useState } from "react";
import { ConfirmButton } from "./ConfirmButton";
import { FAMILIES, defaultQuant, estimateQ4, familyVariants, topVariants, fits, formatBytes, formatCount, formatParams, listQuants, searchVariants, type Family, type Quant, type Source, type Variant } from "./catalog";
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
              <ConfirmButton title="Delete model" onConfirm={() => run(deleteModel(engine, m.id).then(() => window.photon?.pruneModels(m.id.split(":")[0])))}>
                <TrashIcon />
              </ConfirmButton>
            )}
          </div>
        );
      })}
    </>
  );
}

function Discover(props: TabProps) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<Family | null>(null);

  return (
    <>
      <form className="search" onSubmit={(e) => (e.preventDefault(), setQuery(draft.trim()))}>
        <input
          type="search"
          placeholder="Search models, e.g. qwen3 8b"
          value={draft}
          onChange={(e) => (setDraft(e.target.value), !e.target.value.trim() && setQuery(""))}
        />
      </form>
      {query ? (
        <VariantList key={`q:${query}`} title={`Results for “${query}”`} load={() => searchVariants(query)} onBack={() => (setDraft(""), setQuery(""))} {...props} />
      ) : family ? (
        <VariantList key={family.name} title={family.name} subtitle={family.maker} load={() => familyVariants(family)} onBack={() => setFamily(null)} {...props} />
      ) : (
        <>
          <h3 className="section-title">Popular Model Families</h3>
          <div className="family-grid">
            {FAMILIES.map((f) => (
              <button key={f.name} className="family-card" onClick={() => setFamily(f)}>
                <span className="family-name">{f.name}</span>
                <span className="muted small">{f.maker}</span>
              </button>
            ))}
          </div>
          <VariantList title="Top Downloaded from HuggingFace" load={topVariants} {...props} />
        </>
      )}
    </>
  );
}

const SOURCES_SHOWN = 6;

type CatalogProps = Pick<TabProps, "engine" | "models" | "progress" | "info" | "run">;
type ListProps = CatalogProps & { title: string; subtitle?: string; load: () => Promise<Variant[]>; onBack?: () => void };

function VariantList({ title, subtitle, load, onBack, ...props }: ListProps) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [allSources, setAllSources] = useState(false);
  const toggle = (id: string) => (setOpen(open === id ? null : id), setAllSources(false));

  useEffect(() => {
    let live = true;
    load().then((v) => live && setVariants(v), (e) => live && setError(e.message));
    return () => void (live = false);
  }, []);

  return (
    <>
      {onBack ? (
        <div className="list-header">
          <button className="link-btn" onClick={onBack}>← All models</button>
          <h2>{title}</h2>
          {subtitle && <span className="muted">{subtitle}</span>}
        </div>
      ) : (
        <h3 className="section-title">{title}</h3>
      )}
      {error && <p className="banner">{error}</p>}
      {!variants && !error && <p className="muted">Loading…</p>}
      {variants?.length === 0 && <p className="muted">No GGUF models found.</p>}
      {variants?.map((v) => {
        const estimate = v.params ? estimateQ4(v.params) : 0;
        const tooBig = estimate && props.info && !fits(estimate, props.info.totalMem);
        const community = v.sources.every((s) => s.kind === "community");
        const details = [v.org, v.params && `${formatParams(v.params)} params`, v.context && `${Math.round(v.context / 1024)}K context`, `${v.sources.length} source${v.sources.length > 1 ? "s" : ""}`];
        return (
          <div key={v.id} className="repo">
            <button className="row row-btn" onClick={() => toggle(v.id)} aria-expanded={open === v.id}>
              <div className="row-main">
                <div className="row-title">{v.name}</div>
                <div className="muted small">{details.filter(Boolean).join(" · ")}</div>
              </div>
              {estimate > 0 && <span className="muted small" title="Estimated size at Q4_K_M">≈{formatBytes(estimate)}</span>}
              <span className="muted small">{formatCount(v.downloads)} downloads</span>
              {community && <span className="badge warn" title="Not from the model's maker or a trusted quantizer">Community</span>}
              {tooBig && <span className="badge warn">Too large</span>}
              <span className="muted">{open === v.id ? "▾" : "▸"}</span>
            </button>
            {open === v.id && (allSources ? v.sources : v.sources.slice(0, SOURCES_SHOWN)).map((s) => <SourceRow key={s.repo} source={s} {...props} />)}
            {open === v.id && !allSources && v.sources.length > SOURCES_SHOWN && (
              <button className="link-btn more" onClick={() => setAllSources(true)}>
                Show {v.sources.length - SOURCES_SHOWN} more sources
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function SourceRow({ source, engine, models, progress, info, run }: CatalogProps & { source: Source }) {
  const [quants, setQuants] = useState<Quant[] | null>(null);
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listQuants(source.repo).then((q) => (setQuants(q), setTag(defaultQuant(q, info?.totalMem)?.tag ?? "")), (e) => setError(e.message));
  }, [source.repo]);

  const localModel = (t: string) => models.find((m) => m.id.toUpperCase() === `${source.repo}:${t}`.toUpperCase());
  const quant = quants?.find((q) => q.tag === tag);
  const id = `${source.repo}:${tag}`;
  const local = localModel(tag);
  const p = progress[id] ?? (local && sumProgress(local.status.progress));
  const tooBig = quant && info && !fits(quant.size, info.totalMem);
  const noSpace = quant && info && quant.size > info.freeBytes;

  return (
    <div className="row quant">
      <div className="row-main">
        <div className="row-title">
          {source.author} {source.kind === "official" && <span className="badge">Official</span>}
          {source.kind === "community" && <span className="badge warn" title="Unreviewed upload">Community</span>}
        </div>
        <div className="muted small">{formatCount(source.downloads)} downloads</div>
        {local?.status.value === "downloading" && p && <ProgressBar {...p} />}
      </div>
      {error ? (
        <span className="muted small">{error}</span>
      ) : !quants ? (
        <span className="muted small">Loading files…</span>
      ) : quants.length === 0 ? (
        <span className="muted small">No GGUF files</span>
      ) : (
        <>
          <select className="quant-select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Quantization">
            {quants.map((q) => (
              <option key={q.tag} value={q.tag}>
                {q.tag} · {formatBytes(q.size)}{localModel(q.tag) ? " ✓" : ""}
              </option>
            ))}
          </select>
          {info && quant && <span className={`badge ${tooBig ? "warn" : "ok"}`}>{tooBig ? "Too large" : "Fits"}</span>}
          {local ? (
            <span className="muted small status">{local.status.value === "downloading" && p ? percent(p) : local.status.value === "incomplete" ? "Paused" : "Downloaded"}</span>
          ) : (
            <button
              className="secondary-btn"
              disabled={!!source.gated || !!noSpace || engine.status !== "ready"}
              title={source.gated ? "This model requires accepting a license on Hugging Face" : noSpace ? "Not enough disk space" : undefined}
              onClick={() => run(downloadModel(engine, id))}
            >
              Download
            </button>
          )}
        </>
      )}
    </div>
  );
}

const percent = (p: Progress) => (p.total ? `${Math.floor((p.done / p.total) * 100)}%` : "Starting…");

const ProgressBar = (p: Progress) => <progress className="progress" value={p.done} max={p.total || 1} />;
