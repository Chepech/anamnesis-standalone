#!/usr/bin/env node
/**
 * Anamnesis Core Daemon
 *
 * Headless entry point. Loads config, starts the indexer, file watcher,
 * MCP server, and a lightweight management HTTP API.
 *
 * Usage:
 *   node dist/daemon.js [--config /path/to/config.json]
 */

import path from "path";
import fs from "fs";
import * as http from "http";
import { loadConfig, saveConfig, DEFAULT_CONFIG_PATH, type AnamnesisConfig } from "./config.js";
import { VectorDB, SCHEMA_VERSION } from "./db.js";
import { LocalEmbeddingProvider } from "./embedding/local.js";
import { OpenAIEmbeddingProvider } from "./embedding/openai.js";
import { IndexingEngine } from "./indexer.js";
import { FTSIndex } from "./fts.js";
import { HybridSearchEngine } from "./hybrid-search.js";
import { FileWatcher } from "./watcher.js";
import { AnamnesisServerMCP } from "./mcp-server.js";
import type { EmbeddingProvider } from "./embedding/bridge.js";
import type { IndexStatus } from "./indexer.js";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const configPathArg = args[args.indexOf("--config") + 1] ?? DEFAULT_CONFIG_PATH;
const configPath = path.resolve(configPathArg);

// ── Boot ──────────────────────────────────────────────────────────────────────

let config: AnamnesisConfig = loadConfig(configPath);
let db: VectorDB;
let provider: EmbeddingProvider;
let indexer: IndexingEngine;
let fts: FTSIndex;
let search: HybridSearchEngine;
let watcher: FileWatcher;
let mcp: AnamnesisServerMCP;
let mgmtServer: http.Server;
let currentStatus: IndexStatus = { state: "idle" };

async function boot(): Promise<void> {
  console.log("[Anamnesis] Starting daemon...");
  if (config.watchDirs.length === 0) {
    console.warn("[Anamnesis] No watchDirs configured. Add directories to config and restart.");
  }

  // ── Embedding provider ────────────────────────────────────────────────────
  const workerPath = path.join(__dirname, "embedder-worker.js");
  if (config.embeddingProvider === "openai" && config.openaiApiKey) {
    provider = new OpenAIEmbeddingProvider(config.openaiApiKey, config.openaiModelName);
  } else {
    provider = new LocalEmbeddingProvider(workerPath, config.localModelName, path.join(path.dirname(configPath), "models"),
      (msg) => console.log("[Anamnesis] Embedder:", msg));
  }
  await provider.initialize();

  // ── Vector DB ─────────────────────────────────────────────────────────────
  db = new VectorDB(config.dataDir, provider.dimension);
  await db.connect();

  // Check for schema/dim mismatch → trigger re-index
  const storedDim = await db.getStoredDim();
  const storedSchema = await db.getSchemaVersion();
  const needsReindex =
    config.watchDirs.length > 0 &&
    ((storedDim !== null && storedDim !== provider.dimension) ||
      (storedSchema !== null && storedSchema !== SCHEMA_VERSION) ||
      !config.initialIndexDone);

  // ── FTS + search ──────────────────────────────────────────────────────────
  fts = new FTSIndex();
  indexer = new IndexingEngine(db, provider, config, (status) => {
    currentStatus = status;
    broadcastStatus(status);
  }, fts);
  search = new HybridSearchEngine(db, fts, provider, config);

  // Rebuild FTS from existing index in background
  void fts.rebuildFromDB(db).catch((e) => console.warn("[Anamnesis] FTS rebuild failed:", e));

  // ── File watcher ──────────────────────────────────────────────────────────
  watcher = new FileWatcher(indexer, config);
  if (config.autoIndexOnChange) watcher.start();

  // ── MCP server ────────────────────────────────────────────────────────────
  mcp = new AnamnesisServerMCP(search);
  if (config.mcpEnabled) {
    await mcp.start(config.mcpPort).catch((e) => console.error("[Anamnesis] MCP start failed:", e));
  }

  // ── Management API ────────────────────────────────────────────────────────
  const mgmtPort = config.mcpPort + 1;
  mgmtServer = startMgmtServer(mgmtPort);
  console.log(`[Anamnesis] Management API on http://127.0.0.1:${mgmtPort}`);

  // ── Initial index ─────────────────────────────────────────────────────────
  if (needsReindex) {
    console.log("[Anamnesis] Starting initial index...");
    const ok = await indexer.indexAll();
    if (ok) {
      config.initialIndexDone = true;
      config.indexedVectorDim = provider.dimension;
      saveConfig(config, configPath);
    }
  }

  console.log("[Anamnesis] Ready.");
}

// ── Management HTTP API ───────────────────────────────────────────────────────

type StatusListener = (status: IndexStatus) => void;
const statusListeners = new Set<StatusListener>();

function broadcastStatus(status: IndexStatus): void {
  for (const l of statusListeners) {
    try { l(status); } catch { /* ignore */ }
  }
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...collectFiles(full));
      else if (entry.isFile()) results.push(full);
    }
  } catch { /* unreadable dir */ }
  return results;
}

function readBody(req: http.IncomingMessage, cb: (body: unknown) => void): void {
  let raw = "";
  req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
  req.on("end", () => {
    try { cb(raw ? (JSON.parse(raw) as unknown) : {}); } catch { cb({}); }
  });
}

function startMgmtServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (req.method === "GET" && url.pathname === "/status") {
      void db.countRows().then((chunkCount) => {
        res.end(JSON.stringify({
          indexStatus: currentStatus,
          mcpStatus: mcp.status,
          mcpPort: mcp.port,
          chunkCount,
          model: provider.name,
          embeddingProvider: config.embeddingProvider,
          dimension: provider.dimension,
          watchDirs: config.watchDirs,
        }));
      }).catch(() => {
        res.end(JSON.stringify({ indexStatus: currentStatus, mcpStatus: mcp.status, mcpPort: mcp.port, chunkCount: 0, model: provider.name }));
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/reindex") {
      void indexer.indexAll();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/pause") {
      indexer.pause();
      watcher.pauseAll();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/resume") {
      indexer.resume();
      watcher.resumeAll();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/flush") {
      watcher.flushNow();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ── Per-folder endpoints ──────────────────────────────────────────────────

    if (req.method === "GET" && url.pathname === "/dirs") {
      void db.getChunkCountsByDir().then((fileCounts) => {
        const dirChunks = new Map<string, number>();
        for (const [fp, count] of fileCounts) {
          for (const dir of config.watchDirs) {
            if (fp.startsWith(dir)) {
              dirChunks.set(dir, (dirChunks.get(dir) ?? 0) + count);
              break;
            }
          }
        }
        const dirs = config.watchDirs.map((d) => ({
          path: d,
          paused: watcher.isDirPaused(d),
          chunkCount: dirChunks.get(d) ?? 0,
        }));
        res.end(JSON.stringify({ dirs }));
      }).catch(() => {
        const dirs = config.watchDirs.map((d) => ({ path: d, paused: watcher.isDirPaused(d), chunkCount: 0 }));
        res.end(JSON.stringify({ dirs }));
      });
      return;
    }

    if (req.method === "POST" && (url.pathname === "/dirs/pause" || url.pathname === "/dirs/resume" || url.pathname === "/dirs/reindex")) {
      readBody(req, (body) => {
        const { dir } = (body as { dir?: string }) ?? {};
        if (!dir) { res.writeHead(400); res.end(JSON.stringify({ error: "dir required" })); return; }
        if (url.pathname === "/dirs/pause") {
          watcher.pauseDir(dir);
          res.end(JSON.stringify({ ok: true }));
        } else if (url.pathname === "/dirs/resume") {
          watcher.resumeDir(dir);
          res.end(JSON.stringify({ ok: true }));
        } else {
          // reindex a specific directory
          const files = collectFiles(dir).filter((fp) => indexer.isIndexable(fp));
          void indexer.indexFiles(files)
            .then(() => res.end(JSON.stringify({ ok: true })))
            .catch((e: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
        }
      });
      return;
    }

    // ── Vector graph endpoint ─────────────────────────────────────────────────

    if (req.method === "GET" && url.pathname === "/vectors") {
      void db.getAllChunks().then((chunks) => {
        // Dedupe to one chunk per file (first chunk, has representative vector)
        const seen = new Set<string>();
        const nodes = chunks
          .filter((c) => { if (seen.has(c.file_path)) return false; seen.add(c.file_path); return true; })
          .map((c) => ({ id: c.file_path, vector: Array.from(c.vector as unknown as ArrayLike<number>), text: c.text?.slice(0, 120) ?? "" }));
        res.end(JSON.stringify({ nodes }));
      }).catch((e: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
      return;
    }

    // ── MCP start/stop ────────────────────────────────────────────────────────

    if (req.method === "POST" && url.pathname === "/mcp/start") {
      void mcp.start(config.mcpPort).then(() => res.end(JSON.stringify({ ok: true }))).catch((e: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
      return;
    }

    if (req.method === "POST" && url.pathname === "/mcp/stop") {
      void mcp.stop().then(() => res.end(JSON.stringify({ ok: true }))).catch((e: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
      return;
    }

    if (req.method === "GET" && url.pathname === "/search") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "15", 10), 50);
      if (!q) { res.writeHead(400); res.end(JSON.stringify({ error: "q is required" })); return; }
      void search.search(q, limit)
        .then((results) => res.end(JSON.stringify(results)))
        .catch((e: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); });
      return;
    }

    if (req.method === "GET" && url.pathname === "/config") {
      res.end(JSON.stringify(config));
      return;
    }

    if (req.method === "POST" && url.pathname === "/config") {
      readBody(req, (body) => {
        try {
          const updated = body as Partial<AnamnesisConfig>;
          const prevDirs = new Set(config.watchDirs);
          const prevExclude = JSON.stringify(config.excludePatterns ?? []);
          const prevDirExclude = JSON.stringify(config.dirExcludePatterns ?? {});
          config = { ...config, ...updated };
          indexer.updateConfig(config);
          saveConfig(config, configPath);

          // Dynamically add newly configured watch dirs
          if (updated.watchDirs) {
            for (const dir of config.watchDirs) {
              if (!prevDirs.has(dir)) {
                watcher.addDir(dir);
                const files = collectFiles(dir).filter((fp) => indexer.isIndexable(fp));
                if (files.length > 0) void indexer.indexFiles(files).catch((e: unknown) => console.warn("[Anamnesis] Index new dir failed:", e));
              }
            }
          }

          // Purge newly excluded files from the index
          if ((updated.excludePatterns && JSON.stringify(config.excludePatterns) !== prevExclude) ||
              (updated.dirExcludePatterns && JSON.stringify(config.dirExcludePatterns) !== prevDirExclude)) {
            void (async () => {
              try {
                const pathCounts = await db.getChunkCountsByDir();
                const toDelete = [...pathCounts.keys()].filter((fp) => !indexer.isIndexable(fp));
                if (toDelete.length > 0) {
                  await Promise.all(toDelete.map((fp) => indexer.deleteFile(fp)));
                  console.log(`[Anamnesis] Purged ${toDelete.length} file(s) matching updated exclude patterns`);
                }
              } catch (e) {
                console.warn("[Anamnesis] Failed to purge excluded files:", e);
              }
            })();
          }

          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, "127.0.0.1");
  return server;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[Anamnesis] Received ${signal}, shutting down...`);
  indexer.cancel();
  await watcher.stop();
  await mcp.stop();
  provider.terminate?.();
  db.close();
  mgmtServer.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch((err) => {
  console.error("[Anamnesis] Fatal boot error:", err);
  process.exit(1);
});
