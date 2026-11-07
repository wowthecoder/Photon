import { useEffect, useRef, useState } from "react";
import { ConfirmButton } from "./ConfirmButton";
import { generateImage, isDownloaded, loadImageModel, type GeneratedImage, type GenProgress } from "./diffusion";
import { unloadModel, type LocalModel } from "./llm";
import { SidebarIcon, TrashIcon } from "./icons";

const SIZES = [
  { label: "Square · 1024×1024", width: 1024, height: 1024 },
  { label: "Portrait · 832×1216", width: 832, height: 1216 },
  { label: "Landscape · 1216×832", width: 1216, height: 832 },
  { label: "Small · 768×768 (faster)", width: 768, height: 768 },
];

const imageUrl = (id: string) => `photon-image://local/${id}.png`;

type Input = { url: string; width: number; height: number };

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

const loadInput = (url: string) =>
  new Promise<Input>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("That file isn't an image Photon can read."));
    img.src = url;
  });

// keep the input's shape, at most 1024 on the long side, in multiples of 16
function fitSize({ width, height }: Input) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const round = (n: number) => Math.max(256, Math.floor((n * scale) / 16) * 16);
  return { width: round(width), height: round(height) };
}

type Props = {
  hidden: boolean;
  diffusion: EngineState;
  engine: EngineState;
  models: LocalModel[];
  imageModels: ImageModel[];
  gallery: GeneratedImage[];
  setGallery: (fn: (g: GeneratedImage[]) => GeneratedImage[]) => void;
  sidebarOpen: boolean;
  onExpand: () => void;
  onOpenModels: () => void;
};

type Job = { width: number; height: number; loading: boolean; progress?: GenProgress };

// Stays mounted while hidden (see App) so a generation keeps going when you switch to a chat.
export function Images({ hidden, diffusion, engine, models, imageModels, gallery, setGallery, sidebarOpen, onExpand, onOpenModels }: Props) {
  const ready = imageModels.filter(isDownloaded);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState(0);
  const [seed, setSeed] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<GeneratedImage | null>(null);
  const [input, setInput] = useState<Input | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const focusPrompt = useRef(false);
  const model = ready.find((m) => m.id === modelId) ?? ready[0];
  const canEdit = !!model?.edit;
  const useInput = canEdit && !!input;
  const needsInput = model?.edit === "required" && !input;
  const canGenerate = diffusion.status === "ready" && !!model && !!prompt.trim() && !job && !needsInput;
  // size -1 means "same as the input image"
  const dims = size === -1 && useInput ? fitSize(input) : SIZES[Math.max(size, 0)];

  async function chooseInput(source: Blob | string | undefined) {
    if (!source) return;
    try {
      setInput(await loadInput(typeof source === "string" ? source : await toDataUrl(source)));
      setSize(-1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function clearInput() {
    setInput(null);
    if (size === -1) setSize(0);
  }

  async function editImage(image: GeneratedImage) {
    if (!canEdit) setModelId((ready.find((m) => m.edit === "required") ?? ready.find((m) => m.edit))?.id ?? modelId);
    // read through the main process: the page can't fetch photon-image:// across origins
    await chooseInput(`data:image/png;base64,${await window.photon!.readImage(image.id)}`);
    focusPrompt.current = true;
    setOpen(null);
  }

  async function generate() {
    if (!canGenerate) return;
    const text = prompt.trim();
    const { width, height } = dims;
    const refs = useInput ? [input.url] : undefined;
    const n = Number(seed);
    const useSeed = seed.trim() && Number.isInteger(n) && n >= 0 ? n : Math.floor(Math.random() * 2 ** 31);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError("");
    setJob({ width, height, loading: true });
    const started = Date.now();
    try {
      // free the chat model first: a chat model and an image model may not both fit in memory
      // ponytail: always swaps; keep both loaded when they fit if reloading the chat model gets annoying
      await Promise.all(models.filter((m) => ["loaded", "loading"].includes(m.status.value)).map((m) => unloadModel(engine, m.id).catch(() => {})));
      await loadImageModel(diffusion, model);
      setJob({ width, height, loading: false });
      const b64 = await generateImage(diffusion, { prompt: text, width, height, seed: useSeed, ref_images: refs }, (progress) => setJob({ width, height, loading: false, progress }), ctrl.signal);
      const image = { id: crypto.randomUUID(), prompt: text, model: model.name, width, height, seed: useSeed, created: Date.now(), seconds: Math.round((Date.now() - started) / 1000), edited: !!refs };
      await window.photon!.saveImage(image.id, b64);
      setGallery((g) => [image, ...g]);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setJob(null);
      abortRef.current = null;
    }
  }

  // focus the prompt once the viewer is gone; removing an open dialog sends focus to the page body
  useEffect(() => {
    if (open || !focusPrompt.current) return;
    focusPrompt.current = false;
    promptRef.current?.focus();
  }, [open]);

  function reuse(image: GeneratedImage) {
    setPrompt(image.prompt);
    setSeed(String(image.seed));
    const i = SIZES.findIndex((s) => s.width === image.width && s.height === image.height);
    if (i >= 0) setSize(i);
    setOpen(null);
  }

  async function remove(image: GeneratedImage) {
    await window.photon?.deleteImage(image.id);
    setGallery((g) => g.filter((x) => x.id !== image.id));
    setOpen(null);
  }

  const status = !job ? "" : job.loading ? "Loading model…" : job.progress ? `Step ${job.progress.step} of ${job.progress.total}` : "Starting…";

  return (
    <main className="chat" hidden={hidden}>
      <header className={`titlebar ${sidebarOpen ? "" : "inset"}`}>
        {!sidebarOpen && <button className="icon-btn" onClick={onExpand} title="Show sidebar (⌘B)"><SidebarIcon /></button>}
        <div className="chat-heading">Images</div>
      </header>
      <div className="page">
        {diffusion.status === "error" && (
          <div className="banner">
            {diffusion.error} <button className="link-btn" onClick={() => window.photon?.restartDiffusion()}>Restart image engine</button>
          </div>
        )}
        {error && <div className="banner" onClick={() => setError("")}>{error}</div>}

        {ready.length === 0 ? (
          <div className="empty-card">
            <p>Download an image model to start generating images on your Mac.</p>
            <button className="primary-btn" onClick={onOpenModels}>Browse image models</button>
          </div>
        ) : (
          <form
            className="image-composer"
            onSubmit={(e) => (e.preventDefault(), generate())}
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => canEdit && (e.preventDefault(), chooseInput(e.dataTransfer.files[0]))}
          >
            {canEdit && (
              <div className="input-image">
                {input ? (
                  <>
                    <img src={input.url} alt="Input image" />
                    <span className="muted small">Input image · {input.width}×{input.height}</span>
                    <button type="button" className="link-btn small" disabled={!!job} onClick={clearInput}>Remove</button>
                  </>
                ) : (
                  <>
                    <label className="secondary-btn">
                      Add input image
                      <input type="file" accept="image/*" hidden disabled={!!job} onChange={(e) => (chooseInput(e.target.files?.[0]), (e.target.value = ""))} />
                    </label>
                    <span className="muted small">
                      {model.edit === "required" ? "This model edits an image: add one, drop it here, or pick Edit on an image below." : "Optional: add an image to edit it instead of starting from scratch."}
                    </span>
                  </>
                )}
              </div>
            )}
            <textarea
              ref={promptRef}
              rows={3}
              value={prompt}
              placeholder={useInput || model.edit === "required" ? "Describe the change, e.g. make it night time" : "Describe the image you want"}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) (e.preventDefault(), generate());
              }}
            />
            <div className="image-controls">
              <select className="quant-select" value={model?.id} disabled={!!job} onChange={(e) => setModelId(e.target.value)} aria-label="Image model">
                {ready.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select className="quant-select" value={size === -1 && !useInput ? 0 : size} disabled={!!job} onChange={(e) => setSize(Number(e.target.value))} aria-label="Size">
                {useInput && <option value={-1}>Same as input · {fitSize(input).width}×{fitSize(input).height}</option>}
                {SIZES.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}
              </select>
              <input className="seed-input" type="number" min={0} placeholder="Random seed" value={seed} disabled={!!job} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" />
              <span className="spacer" />
              {job ? (
                <button type="button" className="secondary-btn" onClick={() => abortRef.current?.abort()}>Stop</button>
              ) : (
                <button type="submit" className="primary-btn" disabled={!canGenerate} title={needsInput ? "Add an input image first" : undefined}>
                  {useInput ? "Edit" : "Generate"}
                </button>
              )}
            </div>
          </form>
        )}

        {job && (
          <div className="gen-card">
            <div className="gen-preview" style={{ aspectRatio: `${job.width} / ${job.height}` }}>
              {job.progress?.preview && <img src={`data:image/png;base64,${job.progress.preview}`} alt="Preview of the image being generated" />}
            </div>
            <div className="muted small">{status}</div>
            <progress className="progress" value={job.progress?.step ?? 0} max={job.progress?.total ?? 1} />
          </div>
        )}

        {gallery.length > 0 && <h3 className="section-title">Your images</h3>}
        <div className="gallery">
          {gallery.map((image) => (
            <button key={image.id} className="thumb" onClick={() => setOpen(image)} title={image.prompt}>
              <img src={imageUrl(image.id)} alt={image.prompt} loading="lazy" />
            </button>
          ))}
        </div>
      </div>
      {open && (
        <Viewer
          key={open.id}
          image={open}
          onClose={() => setOpen(null)}
          onReuse={() => reuse(open)}
          onEdit={ready.some((m) => m.edit) ? () => editImage(open) : undefined}
          onDelete={() => remove(open)}
        />
      )}
    </main>
  );
}

type ViewerProps = { image: GeneratedImage; onClose: () => void; onReuse: () => void; onEdit?: () => void; onDelete: () => void };

function Viewer({ image, onClose, onReuse, onEdit, onDelete }: ViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} className="viewer" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current.close()}>
      <img src={imageUrl(image.id)} alt={image.prompt} />
      <div className="viewer-info">
        <p className="viewer-prompt">{image.prompt}</p>
        <p className="muted small">
          {image.edited ? "Edited with " : ""}{image.model} · {image.width}×{image.height} · seed {image.seed} · {image.seconds}s · {new Date(image.created).toLocaleString()}
        </p>
        <div className="viewer-actions">
          <button className="secondary-btn" onClick={onReuse}>Use prompt and seed</button>
          {onEdit && <button className="secondary-btn" onClick={onEdit}>Edit this image</button>}
          <button className="secondary-btn" onClick={() => window.photon?.revealImage(image.id)}>Show in Finder</button>
          <button className="secondary-btn" onClick={() => navigator.clipboard.writeText(image.prompt)}>Copy prompt</button>
          <span className="spacer" />
          <ConfirmButton title="Delete image" onConfirm={onDelete}><TrashIcon /></ConfirmButton>
          <button className="primary-btn" onClick={() => ref.current?.close()}>Done</button>
        </div>
      </div>
    </dialog>
  );
}
