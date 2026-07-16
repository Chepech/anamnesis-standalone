/**
 * Embedder worker — runs fastembed in a separate Node.js worker thread.
 * Uses worker_threads parentPort for communication with local.ts.
 */

import { parentPort } from "worker_threads";
import type { MainToWorkerMsg } from "./bridge.js";
import { LOCAL_MODELS } from "./models.js";

if (!parentPort) throw new Error("Must run as a worker thread");

let model: any = null;
let embDim = 384;

parentPort.on("message", async (msg: MainToWorkerMsg) => {
  if (msg.type === "init") {
    try {
      const mapping = LOCAL_MODELS[msg.modelName] ?? { fastembedEnum: "AllMiniLML6V2", dim: 384 };
      embDim = msg.dim ?? mapping.dim;

      parentPort!.postMessage({ type: "progress", status: "downloading", file: msg.modelName });

      const fastembed = await import("fastembed");
      const EmbeddingModel = fastembed.EmbeddingModel;
      const modelEnum = (EmbeddingModel as Record<string, string>)[mapping.fastembedEnum];

      if (!modelEnum) {
        throw new Error(`Unsupported model: ${msg.modelName} (mapped to ${mapping.fastembedEnum})`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model = await fastembed.FlagEmbedding.init({
        model: modelEnum as any,
        cacheDir: msg.cacheDir,
        showDownloadProgress: false,
      } as any);

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
