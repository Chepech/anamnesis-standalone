import * as esbuild from "esbuild";

const isProduction = process.argv[2] === "production";

// Packages that must stay external:
//   - native .node addons (@lancedb, onnxruntime-node, apache-arrow, @anush008/tokenizers)
//   - packages loaded via dynamic import at runtime (fastembed, openai)
//   - complex parsers that bundle their own compiled assets (pdf-parse/pdf.js, mammoth)
//   - packages that use optional native deps (jsdom, chokidar)
//
// Everything else (pure-JS, statically imported) is bundled so it does not need
// to be shipped in node_modules inside the installer.
const external = [
  // Native addons
  "@lancedb/lancedb",
  "apache-arrow",
  "onnxruntime-node",
  "@anush008/tokenizers",
  // Dynamic imports — esbuild cannot tree-shake these
  "fastembed",
  "openai",
  // Complex packages with bundled compiled assets or optional native deps
  "jsdom",
  "mammoth",
  "pdf-parse",
  "chokidar",
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
