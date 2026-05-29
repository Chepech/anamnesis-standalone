import * as esbuild from "esbuild";

const isProduction = process.argv[2] === "production";

// Packages that must stay external:
//   - native .node addons (@lancedb, onnxruntime-node, apache-arrow)
//   - packages loaded via dynamic import at runtime (@xenova/transformers, openai)
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
  // Dynamic imports — esbuild cannot tree-shake these
  "@xenova/transformers",
  "openai",
  // Complex packages with bundled compiled assets or optional native deps
  "jsdom",
  "mammoth",
  "pdf-parse",
  "chokidar",
  // Optional native deps (not in use but referenced as optionalDependencies)
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
