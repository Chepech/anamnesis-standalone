import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";
import type { CoreManager, CoreStatus, CoreStatusPayload } from "./core-manager.js";
import type { WindowsManager } from "./windows.js";

export class TrayManager {
  private tray: Tray | null = null;
  private coreManager: CoreManager;
  private windowsManager: WindowsManager;
  private lastPayload: CoreStatusPayload = { status: "stopped" };

  constructor(coreManager: CoreManager, windowsManager: WindowsManager) {
    this.coreManager = coreManager;
    this.windowsManager = windowsManager;
  }

  create(): void {
    const iconPath = this.iconPath("idle");
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon);
    this.tray.setToolTip("Anamnesis");
    this.tray.on("click", () => this.windowsManager.openSettings());
    this.updateMenu(this.lastPayload);

    this.coreManager.onStatus((payload) => {
      this.lastPayload = payload;
      this.updateTrayIcon(payload.status);
      this.updateMenu(payload);
    });
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private updateTrayIcon(status: CoreStatus): void {
    if (!this.tray) return;
    const iconName = status === "running" ? "idle"
      : status === "starting" ? "indexing"
      : status === "error" ? "error"
      : "stopped";
    const icon = nativeImage.createFromPath(this.iconPath(iconName));
    this.tray.setImage(icon);
  }

  private updateMenu(payload: CoreStatusPayload): void {
    if (!this.tray) return;

    const statusLabel = this.statusLabel(payload);
    const mcpLabel = payload.mcpPort
      ? `MCP: ${payload.mcpStatus === "running" ? `Running on :${payload.mcpPort}` : "Stopped"}`
      : "MCP: Not configured";

    const isIndexing = (payload.indexStatus as { state?: string } | undefined)?.state === "indexing";
    const isPaused = (payload.indexStatus as { state?: string } | undefined)?.state === "paused";

    const menu = Menu.buildFromTemplate([
      { label: "Anamnesis", enabled: false },
      { type: "separator" },
      { label: statusLabel, enabled: false },
      { label: mcpLabel, enabled: false },
      { type: "separator" },
      { label: "Open Settings", click: () => this.windowsManager.openSettings() },
      { type: "separator" },
      ...(isIndexing
        ? [{ label: "Pause Indexing", click: () => void this.coreManager.pause() }]
        : isPaused
          ? [{ label: "Resume Indexing", click: () => void this.coreManager.resume() }]
          : []),
      { label: "Re-index Now", click: () => void this.coreManager.reindex() },
      { type: "separator" } as Electron.MenuItemConstructorOptions,
      { label: "Quit", click: () => app.quit() },
    ]);

    this.tray.setContextMenu(menu);
  }

  private statusLabel(payload: CoreStatusPayload): string {
    if (payload.status === "stopped") return "Status: Stopped";
    if (payload.status === "starting") return "Status: Starting...";
    if (payload.status === "error") return `Status: Error${payload.error ? ` — ${payload.error}` : ""}`;

    const idx = payload.indexStatus as { state?: string; current?: number; total?: number } | undefined;
    if (idx?.state === "indexing") return `Indexing ${idx.current ?? 0} / ${idx.total ?? 0}`;
    if (idx?.state === "paused") return "Status: Paused";
    if (idx?.state === "queued") return "Status: Changes queued";
    if (idx?.state === "error") return "Status: Index error";
    return "Status: Running";
  }

  private iconPath(state: string): string {
    // TODO: replace with actual icon assets
    const assetDir = path.join(__dirname, "..", "..", "assets", "icons");
    return path.join(assetDir, `${state}.png`);
  }
}
