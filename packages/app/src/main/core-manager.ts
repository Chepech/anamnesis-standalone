import { spawn, type ChildProcess } from "child_process";
import path from "path";
import http from "http";
import { app } from "electron";

export type CoreStatus = "stopped" | "starting" | "running" | "error";

export interface DirInfo {
  path: string;
  paused: boolean;
  chunkCount: number;
}

export interface CoreStatusPayload {
  status: CoreStatus;
  indexStatus?: unknown;
  mcpStatus?: string;
  mcpPort?: number;
  chunkCount?: number;
  model?: string;
  embeddingProvider?: string;
  dimension?: number;
  watchDirs?: string[];
  error?: string;
}

type StatusListener = (payload: CoreStatusPayload) => void;

export class CoreManager {
  private process: ChildProcess | null = null;
  private _status: CoreStatus = "stopped";
  private listeners = new Set<StatusListener>();
  private configPath: string;
  private mcpPort: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastPayload: CoreStatusPayload = { status: "stopped" };

  constructor(configPath: string, mcpPort = 8868) {
    this.configPath = configPath;
    this.mcpPort = mcpPort;
  }

  get status(): CoreStatus { return this._status; }
  get payload(): CoreStatusPayload { return this.lastPayload; }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.process) return;
    this._setStatus("starting");

    const coreBin = this.resolveCoreBin();
    console.log("[Anamnesis] Spawning core daemon:", coreBin);

    // In dev, native addons are compiled for system Node — use "node" from PATH.
    // In packaged builds, Electron ships its own Node; ELECTRON_RUN_AS_NODE=1 runs
    // the binary as plain Node so native modules built with electron-rebuild work.
    const [bin, extraEnv]: [string, Record<string, string>] = app.isPackaged
      ? [process.execPath, { ELECTRON_RUN_AS_NODE: "1" }]
      : ["node", {}];

    this.process = spawn(bin, [coreBin, "--config", this.configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...extraEnv },
    });

    this.process.stdout?.on("data", (data: Buffer) => process.stdout.write(`[core] ${data}`));
    this.process.stderr?.on("data", (data: Buffer) => process.stderr.write(`[core] ${data}`));

    this.process.on("exit", (code) => {
      console.log(`[Anamnesis] Core process exited with code ${code}`);
      this.process = null;
      this._setStatus(code === 0 ? "stopped" : "error", String(code));
      this.stopPolling();
    });

    await this.waitForReady();
    this.startPolling();
  }

  async stop(): Promise<void> {
    this.stopPolling();
    if (!this.process) return;
    this.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.process?.kill("SIGKILL"); resolve(); }, 5_000);
      this.process!.on("exit", () => { clearTimeout(t); resolve(); });
    });
    this.process = null;
    this._setStatus("stopped");
  }

  // ── Index controls ────────────────────────────────────────────────────────

  async reindex(): Promise<void> { await this.post("/reindex"); }
  async pause(): Promise<void> { await this.post("/pause"); }
  async resume(): Promise<void> { await this.post("/resume"); }
  async flush(): Promise<void> { await this.post("/flush"); }

  // ── Per-folder ────────────────────────────────────────────────────────────

  async getDirs(): Promise<DirInfo[]> {
    const data = await this.get<{ dirs: DirInfo[] }>("/dirs");
    return data.dirs ?? [];
  }

  async pauseDir(dir: string): Promise<void> { await this.post("/dirs/pause", { dir }); }
  async resumeDir(dir: string): Promise<void> { await this.post("/dirs/resume", { dir }); }
  async reindexDir(dir: string): Promise<void> { await this.post("/dirs/reindex", { dir }); }

  // ── MCP ───────────────────────────────────────────────────────────────────

  async startMcp(): Promise<void> { await this.post("/mcp/start"); }
  async stopMcp(): Promise<void> { await this.post("/mcp/stop"); }

  // ── Graph vectors ─────────────────────────────────────────────────────────

  async getVectors(): Promise<{ id: string; vector: number[]; text: string }[]> {
    const data = await this.get<{ nodes: { id: string; vector: number[]; text: string }[] }>("/vectors");
    return data.nodes ?? [];
  }

  // ── Config ────────────────────────────────────────────────────────────────

  async getConfig(): Promise<unknown> {
    return this.get("/config");
  }

  async saveConfig(partial: unknown): Promise<void> {
    await this.post("/config", partial);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private resolveCoreBin(): string {
    const packaged = path.join(process.resourcesPath ?? "", "core", "daemon.js");
    // __dirname is packages/app/dist/main — go up 3 levels to reach packages/
    const dev = path.join(__dirname, "..", "..", "..", "core", "dist", "daemon.js");
    return require("fs").existsSync(packaged) ? packaged : dev;
  }

  private get mgmtPort(): number { return this.mcpPort + 1; }

  private async waitForReady(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { await this.get("/status"); this._setStatus("running"); return; }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    throw new Error("Core daemon did not become ready in time");
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.get<CoreStatusPayload>("/status").then((payload) => {
        this.lastPayload = { ...payload, status: "running" };
        if (this._status !== "running") this._setStatus("running");
        for (const l of this.listeners) l(this.lastPayload);
      }).catch(() => {
        if (this._status === "running") this._setStatus("error", "Lost connection to core");
      });
    }, 3_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private get<T>(endpoint: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.mgmtPort}${endpoint}`, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => { body += c; });
        res.on("end", () => { try { resolve(JSON.parse(body) as T); } catch { reject(new Error("bad json")); } });
      });
      req.on("error", reject);
      req.setTimeout(5_000, () => req.destroy());
    });
  }

  private post(endpoint: string, data?: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = data ? JSON.stringify(data) : "";
      const req = http.request(
        { hostname: "127.0.0.1", port: this.mgmtPort, path: endpoint, method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
        (res) => { res.resume(); res.on("end", resolve); }
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  }

  private _setStatus(status: CoreStatus, error?: string): void {
    this._status = status;
    this.lastPayload = { ...this.lastPayload, status, error };
    for (const l of this.listeners) l(this.lastPayload);
  }
}
