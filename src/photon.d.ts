type EngineState = { status: "starting" | "ready" | "error"; url?: string; apiKey?: string; error?: string };
type FileState = "done" | "downloading" | "paused" | "missing" | "error";
type ImageModelFile = { slot: string; repo: string; path: string; size: number; id: string; done: number; state: FileState; error?: string };
type ImageModel = { id: string; name: string; maker: string; recipe: string; license: string; description: string; url: string; files: ImageModelFile[] };
type SystemInfo = { modelsDir: string; freeBytes: number; usedBytes: number; totalMem: number };

interface Window {
  photon?: {
    engine(): Promise<EngineState>;
    restartEngine(): Promise<void>;
    onEngine(cb: (state: EngineState) => void): () => void;
    diffusion(): Promise<EngineState>;
    restartDiffusion(): Promise<void>;
    onDiffusion(cb: (state: EngineState) => void): () => void;
    imageModels(): Promise<ImageModel[]>;
    onImageModels(cb: (list: ImageModel[]) => void): () => void;
    downloadImageModel(id: string): Promise<void>;
    pauseImageModel(id: string): Promise<void>;
    deleteImageModel(id: string): Promise<void>;
    saveImage(id: string, b64: string): Promise<void>;
    deleteImage(id: string): Promise<void>;
    revealImage(id: string): Promise<void>;
    info(): Promise<SystemInfo>;
    chooseModelsDir(): Promise<boolean>;
    revealModelsDir(): Promise<void>;
    pruneModels(repo: string): Promise<void>;
  };
}
