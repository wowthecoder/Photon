type EngineState = { status: "starting" | "ready" | "error"; url?: string; apiKey?: string; error?: string };
type SystemInfo = { modelsDir: string; freeBytes: number; usedBytes: number; totalMem: number };

interface Window {
  photon?: {
    engine(): Promise<EngineState>;
    restartEngine(): Promise<void>;
    onEngine(cb: (state: EngineState) => void): () => void;
    info(): Promise<SystemInfo>;
    chooseModelsDir(): Promise<boolean>;
    revealModelsDir(): Promise<void>;
    pruneModels(repo: string): Promise<void>;
  };
}
