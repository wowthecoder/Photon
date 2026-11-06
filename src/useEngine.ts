import { useCallback, useEffect, useState } from "react";
import { listModels, sumProgress, watchModels, type LocalModel, type Progress } from "./llm";

const initial: EngineState = window.photon ? { status: "starting" } : { status: "error", error: "The model engine only runs in the desktop app." };

export function useEngine() {
  const [engine, setEngine] = useState(initial);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [diffusion, setDiffusion] = useState(initial);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);

  useEffect(() => {
    if (!window.photon) return;
    window.photon.engine().then(setEngine);
    window.photon.diffusion().then(setDiffusion);
    window.photon.imageModels().then(setImageModels);
    const offs = [window.photon.onEngine(setEngine), window.photon.onDiffusion(setDiffusion), window.photon.onImageModels(setImageModels)];
    return () => offs.forEach((off) => off());
  }, []);

  const refresh = useCallback(() => {
    window.photon?.info().then(setInfo);
    window.photon?.imageModels().then(setImageModels);
    if (engine.status === "ready") listModels(engine).then(setModels, () => {});
    else setModels([]);
  }, [engine]);

  useEffect(() => {
    refresh();
    if (engine.status !== "ready") return;
    const ctrl = new AbortController();
    watchModels(
      engine,
      (e) => {
        if (e.event === "download_progress") return setProgress((p) => ({ ...p, [e.model]: sumProgress(e.data?.progress) }));
        if (e.data?.status !== "downloading") setProgress(({ [e.model]: _, ...rest }) => rest);
        refresh();
      },
      ctrl.signal,
    ).catch(() => {});
    return () => ctrl.abort();
  }, [engine, refresh]);

  return { engine, models, progress, info, refresh, diffusion, imageModels };
}
