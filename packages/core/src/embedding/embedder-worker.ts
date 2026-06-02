/**
 * Embedder worker — runs fastembed in a separate Node.js worker thread.
 * Uses worker_threads parentPort for communication with local.ts.
 */

import { parentPort } from "worker_threads";
import type { MainToWorkerMsg } from "./bridge.js";

if (!parentPort) throw new Error("Must run as a worker thread");

let model: any = null;
let embDim = 384;

const MODEL_MAP: Record<string, { enum: string; dim: number }> = {
  "Xenova/all-MiniLM-L6-v2": { enum: "AllMiniLML6V2", dim: 384 },
  "Xenova/paraphrase-MiniLM-L3-v2": { enum: "AllMiniLML6V2", dim: 384 },
  "Xenova/all-mpnet-base-v2": { enum: "BGEBaseENV15", dim: 768 },
  "BAAI/bge-base-en-v1.5": { enum: "BGEBaseENV15", dim: 768 },
  "BAAI/bge-small-en-v1.5": { enum: "BGESmallENV15", dim: 384 },
  "sentence-transformers/all-MiniLM-L6-v2": { enum: "AllMiniLML6V2", dim: 384 },
};

parentPort.on("message", async (msg: MainToWorkerMsg) => {
  if (msg.type === "init") {
    try {
      const mapping = MODEL_MAP[msg.modelName] ?? { enum: "AllMiniLML6V2", dim: 384 };
      embDim = msg.dim ?? mapping.dim;

      parentPort!.postMessage({ type: "progress", status: "downloading", file: msg.modelName });

      const fastembed = await import("fastembed");
      const EmbeddingModel = fastembed.EmbeddingModel;
      const modelEnum = (EmbeddingModel as Record<string, string>)[mapping.enum];

      if (!modelEnum) {
        throw new Error(`Unsupported model: ${msg.modelName} (mapped to ${mapping.enum})`);
      }

      model = await fastembed.FlagEmbedding.init({
        model: modelEnum,
        cacheDir: msg.cacheDir,
        showDownloadProgress: false,
      });

      parentPort!.postMessage({ type: "ready" });
    } catch (err: unknown) {
      parentPort!.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "embed") {
    try {
      if (!model) throw new Error("Model not initialized");

      const allEmbeddings: number[][] = [];
      for await (const batch of model.embed(msg.texts, 256)) {
        allEmbeddings.push(...batch);
      }

      const flat: number[] = [];
      for (const vec of allEmbeddings) {
        for (let i = 0; i < vec.length; i++) flat.push(vec[i]);
      }

      parentPort!.postMessage({ type: "result", id: msg.id, flat, dim: embDim });
    } catch (err: unknown) {
      parentPort!.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
});
