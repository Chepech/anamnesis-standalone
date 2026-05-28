import { Tray, Menu, nativeImage, app } from "electron";
import path from "path";
import type { CoreManager, CoreStatusPayload } from "./core-manager.js";
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
    const iconPath = this.resolveIcon();
    const icon = nativeImage.createFromPath(iconPath);

    this.tray = new Tray(process.platform === "darwin" ? icon.resize({ width: 18, height: 18 }) : icon);
    this.tray.setToolTip("Anamnesis");

    // Left-click opens control panel
    this.tray.on("click", () => this.windowsManager.openPanel());

    this.updateMenu(this.lastPayload);

    this.coreManager.onStatus((payload) => {
      this.lastPayload = payload;
      this.updateMenu(payload);
    });
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  // ── Menu — mirrors the Obsidian plugin's showStatusMenu exactly ───────────

  private updateMenu(payload: CoreStatusPayload): void {
    if (!this.tray) return;

    const idx = payload.indexStatus as { state?: string; count?: number; message?: string } | undefined;
    const state = idx?.state ?? "idle";
    const mcpRunning = payload.mcpStatus === "running";
    const items: Electron.MenuItemConstructorOptions[] = [];

    // ── Index state-dependent controls ───────────────────────────────────────

    if (state === "indexing") {
      items.push(
        { label: "Pause indexing", icon: this.icon("pause"), click: () => void this.coreManager.pause() },
        { label: "Cancel indexing", icon: this.icon("x"), click: () => void this.coreManager.reindex() }
      );
    } else if (state === "paused") {
      items.push(
        { label: "Resume indexing", icon: this.icon("play"), click: () => void this.coreManager.resume() },
        { label: "Cancel indexing", icon: this.icon("x"), click: () => void this.coreManager.pause() }
      );
    } else if (state === "error") {
      items.push(
        { label: `Error: ${String(idx?.message ?? "")}`, enabled: false },
        { type: "separator" },
        { label: "Re-index vault", icon: this.icon("database"), click: () => void this.coreManager.reindex() }
      );
    } else if (state === "queued") {
      const count = idx?.count ?? 0;
      items.push(
        { label: `${count} file${count === 1 ? "" : "s"} queued — indexing soon`, enabled: false },
        { type: "separator" },
        { label: "Re-index vault now", icon: this.icon("database"), click: () => void this.coreManager.reindex() }
      );
    } else {
      // idle
      items.push(
        { label: "Re-index vault", icon: this.icon("database"), click: () => void this.coreManager.reindex() }
      );
    }

    // ── Always available ──────────────────────────────────────────────────────

    items.push(
      { type: "separator" },
      { label: "Open control panel", icon: this.icon("layout-dashboard"), click: () => this.windowsManager.openPanel() }
    );

    // ── MCP section ───────────────────────────────────────────────────────────

    items.push({ type: "separator" });

    if (mcpRunning) {
      items.push(
        { label: `MCP: port ${payload.mcpPort ?? ""}`, icon: this.icon("server"), enabled: false },
        { label: "Stop MCP server", icon: this.icon("square"), click: () => void this.coreManager.stopMcp() }
      );
    } else if (payload.mcpStatus !== undefined) {
      items.push(
        { label: "Start MCP server", icon: this.icon("play"), click: () => void this.coreManager.startMcp() }
      );
    } else {
      items.push({ label: "MCP: Disabled", icon: this.icon("server"), enabled: false });
    }

    items.push(
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    );

    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private resolveIcon(): string {
    // Prefer assets/ in the project root (works in dev and packaged)
    const candidates = [
      path.join(__dirname, "..", "..", "..", "..", "assets", "AnamnesisLogo.ico"),
      path.join(process.resourcesPath ?? "", "assets", "AnamnesisLogo.ico"),
    ];
    for (const p of candidates) {
      if (require("fs").existsSync(p)) return p;
    }
    return candidates[0]; // fallback — Electron handles missing gracefully
  }

  private icon(_name: string): Electron.NativeImage | undefined {
    // Native menu icons on macOS require template images; skip on other platforms
    return undefined;
  }
}
