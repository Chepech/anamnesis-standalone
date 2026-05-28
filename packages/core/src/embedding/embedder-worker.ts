/**
 * Embedder worker — runs @xenova/transformers in a separate Node.js worker thread.
 * Uses worker_threads parentPort instead of the browser's self/postMessage.
 */

import { parentPort } from "worker_threads";
import type { MainToWorkerMsg } from "./bridge.js";

if (!parentPort) throw new Error("Must run as a worker thread");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Transformers: any = null;
let pipe: unknown = null;
let embDim = 384;

parentPort.on("message", async (msg: MainToWorkerMsg) => {
  if (msg.type === "init") {
    try {
      if (!Transformers) Transformers = await import("@xenova/transformers");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      Transformers.env.cacheDir = msg.cacheDir;
      // In Node.js, ONNX can load WASM from the local cache directly — no Blob URL tricks needed
      embDim = msg.dim ?? 384;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      pipe = await Transformers.pipeline("feature-extraction", msg.modelName, {
        progress_callback: (p: { status: string; file?: string; progress?: number }) => {
          parentPort!.postMessage({ type: "progress", status: p.status, file: p.file, progress: p.progress });
        },
      });

      parentPort!.postMessage({ type: "ready" });
    } catch (err: unknown) {
      parentPort!.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === "embed") {
    try {
      if (!pipe) throw new Error("Model not initialized");
      type EmbedFn = (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const output = await (pipe as unknown as EmbedFn)(msg.texts, { pooling: "mean", normalize: true });
      const flat = Array.from(output.data);
      parentPort!.postMessage({ type: "result", id: msg.id, flat, dim: embDim });
    } catch (err: unknown) {
      parentPort!.postMessage({ type: "error", id: msg.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
});
