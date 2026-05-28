import { spawn, type ChildProcess } from "child_process";
import path from "path";
import http from "http";
import { app } from "electron";

export type CoreStatus = "stopped" | "starting" | "running" | "error";

export interface CoreStatusPayload {
  status: CoreStatus;
  indexStatus?: unknown;
  mcpStatus?: string;
  mcpPort?: number;
  model?: string;
  error?: string;
}

type StatusListener = (payload: CoreStatusPayload) => void;

const MGMT_PORT_OFFSET = 1; // core mgmt runs on mcpPort + 1 (default 8869)

export class CoreManager {
  private process: ChildProcess | null = null;
  private _status: CoreStatus = "stopped";
  private listeners = new Set<StatusListener>();
  private configPath: string;
  private mcpPort: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(configPath: string, mcpPort = 8868) {
    this.configPath = configPath;
    this.mcpPort = mcpPort;
  }

  get status(): CoreStatus { return this._status; }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.process) return;
    this._setStatus("starting");

    const coreBin = this.resolveCoreBin();
    console.log("[Anamnesis] Spawning core daemon:", coreBin);

    this.process = spawn(process.execPath, [coreBin, "--config", this.configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => process.stdout.write(`[core] ${data}`));
    this.process.stderr?.on("data", (data: Buffer) => process.stderr.write(`[core] ${data}`));

    this.process.on("exit", (code) => {
      console.log(`[Anamnesis] Core process exited with code ${code}`);
      this.process = null;
      this._setStatus(code === 0 ? "stopped" : "error", String(code));
      this.stopPolling();
    });

    // Poll management API until responsive
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

  async reindex(): Promise<void> {
    await this.mgmtPost("/reindex");
  }

  async pause(): Promise<void> {
    await this.mgmtPost("/pause");
  }

  async resume(): Promise<void> {
    await this.mgmtPost("/resume");
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private resolveCoreBin(): string {
    // In packaged app: resources/core/daemon.js; in dev: sibling package dist
    const packaged = path.join(process.resourcesPath ?? "", "core", "daemon.js");
    const dev = path.join(app.getAppPath(), "..", "core", "dist", "daemon.js");
    return require("fs").existsSync(packaged) ? packaged : dev;
  }

  private async waitForReady(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.fetchStatus();
        this._setStatus("running");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error("Core daemon did not become ready in time");
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.fetchStatus().then((payload) => {
        if (this._status !== "running") this._setStatus("running");
        for (const l of this.listeners) l({ status: "running", ...payload });
      }).catch(() => {
        if (this._status === "running") this._setStatus("error", "Lost connection to core");
      });
    }, 3_000);
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private async fetchStatus(): Promise<Omit<CoreStatusPayload, "status">> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.mcpPort + MGMT_PORT_OFFSET}/status`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(body) as Omit<CoreStatusPayload, "status">); } catch { reject(new Error("bad json")); }
        });
      });
      req.on("error", reject);
      req.setTimeout(2_000, () => req.destroy());
    });
  }

  private async mgmtPost(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: this.mcpPort + MGMT_PORT_OFFSET, path: endpoint, method: "POST" },
        (res) => { res.resume(); res.on("end", resolve); }
      );
      req.on("error", reject);
      req.end();
    });
  }

  private _setStatus(status: CoreStatus, error?: string): void {
    this._status = status;
    for (const l of this.listeners) l({ status, error });
  }
}
