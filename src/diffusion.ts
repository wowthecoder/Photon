import { api, post } from "./llm";

export type GeneratedImage = { id: string; prompt: string; model: string; width: number; height: number; seed: number; created: number; seconds: number; edited?: boolean };
export type GenProgress = { step: number; total: number; preview?: string };

export const modelSize = (m: ImageModel) => m.files.reduce((n, f) => n + f.size, 0);
export const modelDone = (m: ImageModel) => m.files.reduce((n, f) => n + f.done, 0);
export const isDownloaded = (m: ImageModel) => m.files.every((f) => f.state === "done");
export const isDownloading = (m: ImageModel) => m.files.some((f) => f.state === "downloading");
export const modelError = (m: ImageModel) => m.files.find((f) => f.error)?.error;

type ModelFile = { id: string; relative_path: string };

// Loads the model into sd-server; the server no-ops when the same recipe and files are already loaded.
export async function loadImageModel(engine: EngineState, model: ImageModel) {
  await post(engine, "/sdcpp/v1/models/refresh", {});
  const { files: available }: { files: ModelFile[] } = await (await api(engine, "/sdcpp/v1/model-files")).json();
  const models = Object.fromEntries(
    model.files.map((f) => {
      const file = available.find((a) => a.relative_path === f.id);
      if (!file) throw new Error(`${f.id} is missing. Download the model again.`);
      return [f.slot, file.id];
    }),
  );
  await post(engine, "/sdcpp/v1/models/load", { recipe: model.recipe, models });
}

export const unloadImageModel = (engine: EngineState) => post(engine, "/sdcpp/v1/models/unload", {});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Submits a job and polls it until it finishes. Returns the PNG as base64; aborting cancels the job.
export async function generateImage(
  engine: EngineState,
  // ref_images: input images (data URLs) for models that edit an image
  req: { prompt: string; width: number; height: number; seed: number; ref_images?: string[] },
  onProgress: (p: GenProgress) => void,
  signal: AbortSignal,
): Promise<string> {
  const { id } = await (await post(engine, "/sdcpp/v1/img_gen", { ...req, preview: "proj", output_format: "png" })).json();
  const cancel = () => post(engine, `/sdcpp/v1/jobs/${id}/cancel`, {}).catch(() => {});
  signal.addEventListener("abort", cancel);
  try {
    for (;;) {
      const job = await (await api(engine, `/sdcpp/v1/jobs/${id}`)).json();
      if (job.status === "completed") return job.result.images[0].b64_json;
      if (job.status === "failed") throw new Error(job.error?.message ?? "Generation failed");
      if (job.status === "cancelled" || signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (job.preview) onProgress({ step: job.preview.step, total: job.preview.total_steps, preview: job.preview.b64_json });
      await sleep(500);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
