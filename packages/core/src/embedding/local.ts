import path from "path";
import os from "os";
import { Worker } from "worker_threads";
import type { EmbeddingProvider, WorkerToMainMsg } from "./bridge.js";

export const LOCAL_MODEL_DIM: Record<string, number> = {
  "Xenova/all-MiniLM-L6-v2": 384,
  "Xenova/all-mpnet-base-v2": 768,
};

type PendingEmbed = {
  resolve: (v: number[][]) => void;
  reject: (e: Error) => void;
  count: number;
};

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly dimension: number;

  private modelName: string;
  private cacheDir: string;
  private workerPath: string;

  private worker: Worker | null = null;
  private pendingEmbeds = new Map<number, PendingEmbed>();
  private embedIdCounter = 0;

  private onProgress?: (msg: string) => void;

  constructor(
    workerPath: string,
    modelName: string,
    cacheDir?: string,
    onProgress?: (msg: string) => void
  ) {
    this.workerPath = workerPath;
    this.modelName = modelName;
    this.cacheDir = cacheDir ?? path.join(os.homedir(), ".cache", "anamnesis", "models");
    this.dimension = LOCAL_MODEL_DIM[modelName] ?? 384;
    this.onProgress = onProgress;
  }

  async initialize(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.worker = new Worker(this.workerPath);

      const timeout = setTimeout(() => {
        reject(new Error("Worker init timeout after 2 minutes"));
      }, 120_000);

      this.worker.on("message", (msg: WorkerToMainMsg) => {
        if (msg.type === "ready") {
          clearTimeout(timeout);
          this.worker!.removeAllListeners("message");
          this.worker!.on("message", (m: WorkerToMainMsg) => this.handleWorkerMessage(m));
          this.onProgress?.(`Model ready: ${this.modelName}`);
          resolve();
        } else if (msg.type === "progress") {
          if (msg.status === "downloading") {
            const pct = msg.progress ? ` (${Math.round(msg.progress)}%)` : "";
            this.onProgress?.(`Downloading ${msg.file ?? "model"}${pct}`);
          }
        } else if (msg.type === "error" && msg.id === undefined) {
          clearTimeout(timeout);
          reject(new Error(msg.message ?? "Unknown worker error"));
        }
      });

      this.worker.on("error", (e) => {
        clearTimeout(timeout);
        reject(new Error(e.message ?? "Worker load error"));
      });

      this.worker.postMessage({ type: "init", modelName: this.modelName, cacheDir: this.cacheDir, dim: this.dimension });
      this.onProgress?.(`Loading model: ${this.modelName}`);
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.worker) throw new Error("LocalEmbeddingProvider not initialized");
    return this.embedViaWorker(texts);
  }

  terminate(): void {
    if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
    for (const pending of this.pendingEmbeds.values()) {
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingEmbeds.clear();
  }

  private handleWorkerMessage(msg: WorkerToMainMsg): void {
    if (msg.type === "result") {
      const pending = this.pendingEmbeds.get(msg.id);
      if (!pending) return;
      this.pendingEmbeds.delete(msg.id);
      const { dim, flat } = msg;
      const results: number[][] = [];
      for (let i = 0; i < pending.count; i++) results.push(flat.slice(i * dim, (i + 1) * dim));
      pending.resolve(results);
    } else if (msg.type === "error" && msg.id !== undefined) {
      const pending = this.pendingEmbeds.get(msg.id);
      if (!pending) return;
      this.pendingEmbeds.delete(msg.id);
      pending.reject(new Error(msg.message ?? "Embed error"));
    }
  }

  private embedViaWorker(texts: string[]): Promise<number[][]> {
    return new Promise<number[][]>((resolve, reject) => {
      const id = ++this.embedIdCounter;
      this.pendingEmbeds.set(id, { resolve, reject, count: texts.length });
      this.worker!.postMessage({ type: "embed", id, texts });
    });
  }
}
