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

function startMgmtServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

    if (req.method === "GET" && url.pathname === "/status") {
      res.end(JSON.stringify({
        indexStatus: currentStatus,
        mcpStatus: mcp.status,
        mcpPort: mcp.port,
        chunkCount: 0, // TODO: cache this
        model: provider.name,
      }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/reindex") {
      void indexer.indexAll();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/pause") {
      indexer.pause();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/resume") {
      indexer.resume();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/flush") {
      watcher.flushNow();
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/config") {
      res.end(JSON.stringify(config));
      return;
    }

    if (req.method === "POST" && url.pathname === "/config") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const updated = JSON.parse(body) as Partial<AnamnesisConfig>;
          config = { ...config, ...updated };
          saveConfig(config, configPath);
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
