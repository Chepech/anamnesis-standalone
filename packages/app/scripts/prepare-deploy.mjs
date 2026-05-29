/**
 * Prepares the core production deployment for electron-builder.
 *
 * Replaces `pnpm deploy` because pnpm writes a virtual store (.pnpm/) full of
 * symlinks that electron-builder resolves and copies verbatim — inflating the
 * installer to 400+ MB.  Using npm here produces a flat node_modules with no
 * virtual store.
 *
 * Run from the workspace root:  node packages/app/scripts/prepare-deploy.mjs
 *
 * Environment variables:
 *   TARGET_PLATFORM=win32|linux|darwin   keep only binaries for this OS
 *                                        (default: current build platform)
 *
 * CROSS-PLATFORM NOTE
 * @lancedb/lancedb installs a platform-specific native binary at npm-install
 * time.  When building the Windows installer you MUST run this script on a
 * Windows machine (or a Windows CI runner) so that npm pulls
 * @lancedb/lancedb-win32-x64-msvc.  Running on Linux yields the Linux binary,
 * which is dead weight in a Windows installer and will fail to load on Windows.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, "../../..");
const appDir = join(__dirname, "..");
const deployDir = join(appDir, ".deploy-core");
const nodeModulesDir = join(deployDir, "node_modules");
const corePkgPath = join(workspaceRoot, "packages/core/package.json");

const targetPlatform = process.env.TARGET_PLATFORM ?? process.platform;

// ── 1. Clean previous deploy ─────────────────────────────────────────────────
if (existsSync(deployDir)) {
  console.log("Cleaning previous .deploy-core ...");
  rmSync(deployDir, { recursive: true });
}
mkdirSync(deployDir, { recursive: true });

// ── 2. Write a minimal package.json (production deps only) ───────────────────
const corePkg = JSON.parse(readFileSync(corePkgPath, "utf-8"));
const deployPkg = {
  name: "anamnesis-core-deploy",
  version: corePkg.version,
  dependencies: corePkg.dependencies,
};
writeFileSync(join(deployDir, "package.json"), JSON.stringify(deployPkg, null, 2));

// ── 3. npm install — flat node_modules, no .pnpm virtual store ───────────────
console.log("Installing production dependencies (npm) ...");
execSync("npm install --omit=dev --legacy-peer-deps --ignore-scripts=false", {
  cwd: deployDir,
  stdio: "inherit",
});

// ── 4. Remove onnxruntime-web (browser/WASM build — not used in Node.js) ─────
removeDir(join(nodeModulesDir, "onnxruntime-web"), "onnxruntime-web (browser-only)");

// ── 5. Strip off-platform onnxruntime-node binaries ──────────────────────────
//   onnxruntime-node ships win32/linux/darwin in one package.
//   Keeping only the target platform saves ~60 MB.
const onnxBinRoot = join(nodeModulesDir, "onnxruntime-node", "bin", "napi-v3");
if (existsSync(onnxBinRoot)) {
  for (const platform of readdirSync(onnxBinRoot)) {
    if (platform !== targetPlatform) {
      removeDir(join(onnxBinRoot, platform), `onnxruntime-node/${platform} binaries`);
    }
  }
}

// ── 6. Remove sharp (image processing — not needed for text-only embeddings) ──
//   @xenova/transformers requires sharp for image pipelines but falls back
//   gracefully when it is absent.  Text feature-extraction works fine without it.
//   Remove it to save ~17 MB and its transitive bare-* / tar-fs dependencies.
removeDir(join(nodeModulesDir, "sharp"), "sharp (image processing, not needed)");
// Remove sharp's transitive deps that nothing else uses
for (const pkg of ["tar-fs", "tar-stream", "bare-fs", "bare-os", "bare-url", "pump"]) {
  removeDir(join(nodeModulesDir, pkg), `${pkg} (sharp transitive dep)`);
}

// ── 7. Cross-platform sanity warning ─────────────────────────────────────────
if (targetPlatform === "win32" && process.platform !== "win32") {
  console.warn(
    "\n⚠  WARNING: Building Windows installer on a non-Windows host.\n" +
      "   @lancedb/lancedb-linux-x64-gnu was installed instead of the Windows\n" +
      "   binary.  The Windows installer will be oversized and lancedb will NOT\n" +
      "   work on the target machine.\n" +
      "   Run this script on a Windows machine or a Windows CI runner instead.\n",
  );
}

const finalSize = getFolderSize(deployDir);
console.log(`\nDeploy preparation complete.  node_modules: ~${finalSize} MB`);

// ── helpers ───────────────────────────────────────────────────────────────────

function removeDir(dir, label) {
  if (existsSync(dir)) {
    console.log(`Removing ${label} ...`);
    rmSync(dir, { recursive: true });
  }
}

function getFolderSize(dir) {
  try {
    const out = execSync(`du -sm "${dir}"`, { encoding: "utf-8" });
    return out.split("\t")[0];
  } catch {
    return "?";
  }
}
