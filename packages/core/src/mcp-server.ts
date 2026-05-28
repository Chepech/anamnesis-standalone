import * as http from "http";
import fs from "fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { HybridSearchEngine } from "./hybrid-search.js";

export type McpStatus = "stopped" | "running" | "error";

export class AnamnesisServerMCP {
  private hybridSearch: HybridSearchEngine;
  private httpServer: http.Server | null = null;
  private _status: McpStatus = "stopped";
  private _port = 0;
  private _error = "";

  constructor(hybridSearch: HybridSearchEngine) {
    this.hybridSearch = hybridSearch;
  }

  get status(): McpStatus { return this._status; }
  get port(): number { return this._port; }
  get error(): string { return this._error; }

  async start(port: number): Promise<void> {
    if (this.httpServer) await this.stop();
    this._port = port;
    this._error = "";

    this.httpServer = http.createServer((req, res) => { void this.handleRequest(req, res); });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.on("error", (err) => {
        this._status = "error";
        this._error = (err as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? `Port ${port} is already in use` : err.message;
        reject(new Error(this._error));
      });
      this.httpServer!.listen(port, "127.0.0.1", () => {
        this._status = "running";
        console.debug(`[Anamnesis] MCP server listening on http://127.0.0.1:${port}/mcp`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) return;
    this.httpServer.closeAllConnections();
    await new Promise<void>((resolve) => { this.httpServer!.close(() => resolve()); });
    this.httpServer = null;
    this._status = "stopped";
    console.debug("[Anamnesis] MCP server stopped");
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    if (req.url !== "/mcp") { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found"); return; }

    const mcpServer = this.createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => void transport.close());

    try {
      await mcpServer.connect(transport);
      const body = await readBody(req);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) { res.writeHead(500, { "Content-Type": "text/plain" }); res.end(String(err)); }
    }
  }

  private createMcpServer(): McpServer {
    const mcpServer = new McpServer({ name: "Anamnesis", version: "0.1.0" });

    mcpServer.registerTool(
      "search_vault",
      {
        description:
          "Hybrid semantic + keyword search over indexed files. Combines vector similarity with BM25 via Reciprocal Rank Fusion.",
        inputSchema: {
          query: z.string().min(1).describe("Natural language search query"),
          limit: z.number().int().min(1).max(50).default(10).describe("Maximum results (default 10, max 50)"),
        },
      },
      async ({ query, limit }) => {
        const rows = await this.hybridSearch.search(query, limit);
        const results = rows.map((r) => ({
          file_path: r.file_path, context_path: r.context_path, heading: r.heading,
          chunk_index: r.chunk_index, text: r.text, tags: r.tags,
          importance_score: r.importance_score, match_sources: r.match_sources,
          score: r._distance !== undefined ? Math.max(0, 1 - r._distance / 2) : null,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
      }
    );

    mcpServer.registerTool(
      "read_note",
      {
        description: "Read the full content of an indexed file by its absolute path.",
        inputSchema: {
          path: z.string().describe("Absolute path to the file"),
        },
      },
      async ({ path: filePath }) => {
        if (!fs.existsSync(filePath)) {
          return { content: [{ type: "text" as const, text: `File not found: ${filePath}` }], isError: true };
        }
        const content = fs.readFileSync(filePath, "utf8");
        const wordCount = content.split(/\s+/).filter(Boolean).length;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ path: filePath, word_count: wordCount, content }, null, 2) }],
        };
      }
    );

    mcpServer.registerTool(
      "list_indexed_files",
      { description: "List all currently indexed files with their chunk counts." },
      async () => {
        const chunks = await this.hybridSearch.db.getAllChunks();
        const counts = new Map<string, number>();
        for (const c of chunks) counts.set(c.file_path, (counts.get(c.file_path) ?? 0) + 1);
        const files = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([path, chunk_count]) => ({ path, chunk_count }));
        return { content: [{ type: "text" as const, text: JSON.stringify(files, null, 2) }] };
      }
    );

    return mcpServer;
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try { resolve(raw ? JSON.parse(raw) : undefined); } catch { resolve(raw); }
    });
    req.on("error", reject);
  });
}
