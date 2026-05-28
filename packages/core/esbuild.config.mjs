import * as esbuild from "esbuild";

const isProduction = process.argv[2] === "production";

// Native addons and heavy optional deps — must stay external so Node resolves them
// from node_modules at runtime rather than being bundled (they use native .node files).
const external = [
  // Native addons — must stay external
  "@lancedb/lancedb",
  "apache-arrow",
  "onnxruntime-node",
  // Large runtime deps loaded from node_modules at runtime
  "@xenova/transformers",
  "@modelcontextprotocol/sdk",
  "jsdom",
  "@mozilla/readability",
  "mammoth",
  "pdf-parse",
  "gray-matter",
  "turndown",
  "chokidar",
  "minimatch",
  "openai",
  "zod",
  // Optional native deps
  "sharp",
  "canvas",
];

const baseConfig = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external,
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
  logLevel: "info",
};

// Main daemon bundle
await esbuild.build({
  ...baseConfig,
  entryPoints: ["src/daemon.ts"],
  outfile: "dist/daemon.js",
});

// Embedder worker — separate bundle (loaded via worker_threads)
await esbuild.build({
  ...baseConfig,
  entryPoints: ["src/embedding/embedder-worker.ts"],
  outfile: "dist/embedder-worker.js",
});

console.log("Build complete");
