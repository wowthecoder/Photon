type EngineState = { status: "starting" | "ready" | "error"; url?: string; apiKey?: string; error?: string };
type FileState = "done" | "downloading" | "paused" | "missing" | "error";
type ImageModelFile = { slot: string; repo: string; path: string; size: number; id: string; done: number; state: FileState; error?: string };
type ImageModel = {
  id: string;
  name: string;
  repo: string;
  quant: string;
  base: string;
  family: string;
  maker: string;
  recipe: string;
  license: string;
  description: string;
  /** whether the model edits an input image: always, optionally, or not at all */
  edit: "required" | "optional" | null;
  url: string;
  files: ImageModelFile[];
};
type ImageDownload = { base: string; repo: string; path: string; quant: string; size: number };
type SystemInfo = { modelsDir: string; freeBytes: number; usedBytes: number; totalMem: number };

// setUp: false when the connector needs an OAuth app that oauth-clients.json doesn't have
type Connector = { id: string; name: string; description: string; status: "off" | "connecting" | "on" | "error"; error?: string; toolCount: number; setUp: boolean };
type McpTool = { name: string; description: string; parameters: object; readOnly: boolean };

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
    downloadImageModel(spec: ImageDownload | string): Promise<void>;
    pauseImageModel(id: string): Promise<void>;
    deleteImageModel(id: string): Promise<void>;
    saveImage(id: string, b64: string): Promise<void>;
    readImage(id: string): Promise<string>;
    saveAttachment(name: string, b64: string): Promise<void>;
    readAttachment(name: string): Promise<string>;
    deleteAttachments(names: string[]): Promise<void>;
    deleteImage(id: string): Promise<void>;
    revealImage(id: string): Promise<void>;
    connectors(): Promise<Connector[]>;
    onConnectors(cb: (list: Connector[]) => void): () => void;
    connect(id: string): Promise<void>;
    disconnect(id: string): Promise<void>;
    mcpTools(): Promise<McpTool[]>;
    mcpCall(name: string, args: object): Promise<string>;
    info(): Promise<SystemInfo>;
    chooseModelsDir(): Promise<boolean>;
    revealModelsDir(): Promise<void>;
    pruneModels(repo: string): Promise<void>;
  };
}
