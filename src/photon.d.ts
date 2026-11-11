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
type SystemInfo = { modelsDir: string; freeBytes: number; usedBytes: number; totalMem: number; workspaceDir: string };

// setUp: false when the connector needs an OAuth app that oauth-clients.json doesn't have
type Connector = { id: string; name: string; description: string; status: "off" | "connecting" | "on" | "error"; error?: string; toolCount: number; setUp: boolean };
// a tool the model can call: a connector's (<connector id>_<tool>) or one built into Photon (e.g. bash)
// warning: what the approval prompt says the tool may do
// askOutsideWorkspace: runs without asking when its path argument is in Photon's workspace folder (file tools)
type McpTool = { name: string; description: string; parameters: object; readOnly: boolean; warning?: string; askOutsideWorkspace?: boolean };

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
    tools(): Promise<McpTool[]>;
    callTool(name: string, args: object, id: string): Promise<string>;
    cancelTool(id: string): Promise<void>;
    /** whether a file tool's path is in the workspace folder, after following symlinks */
    inWorkspace(path: string): Promise<boolean>;
    revealWorkspace(): Promise<void>;
    /** the SearXNG address web_search uses; "" when there's none */
    searchUrl(): Promise<string>;
    /** an empty address removes it */
    setSearchUrl(url: string): Promise<void>;
    info(): Promise<SystemInfo>;
    chooseModelsDir(): Promise<boolean>;
    revealModelsDir(): Promise<void>;
    pruneModels(repo: string): Promise<void>;
  };
}
