export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  initialize(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
  terminate?(): void;
}

export interface WorkerInitMsg {
  type: "init";
  modelName: string;
  cacheDir: string;
  dim: number;
}

export interface WorkerEmbedMsg {
  type: "embed";
  id: number;
  texts: string[];
}

export interface WorkerProgressMsg {
  type: "progress";
  status: string;
  file?: string;
  progress?: number;
}

export interface WorkerReadyMsg {
  type: "ready";
}

export interface WorkerResultMsg {
  type: "result";
  id: number;
  flat: number[];
  dim: number;
}

export interface WorkerErrorMsg {
  type: "error";
  id?: number;
  message: string;
}

export type WorkerToMainMsg = WorkerProgressMsg | WorkerReadyMsg | WorkerResultMsg | WorkerErrorMsg;
export type MainToWorkerMsg = WorkerInitMsg | WorkerEmbedMsg;
