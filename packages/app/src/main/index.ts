import { app, ipcMain, BrowserWindow } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { CoreManager } from "./core-manager.js";
import { TrayManager } from "./tray.js";
import { WindowsManager } from "./windows.js";

const configPath = app.isPackaged
  ? path.join(app.getPath("userData"), "config.json")
  : path.join(os.homedir(), ".config", "anamnesis-dev", "config.json");

const logPath = path.join(
  app.isPackaged ? app.getPath("logs") : path.join(os.homedir(), ".config", "anamnesis-dev", "logs"),
  "anamnesis.log"
);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let coreManager: CoreManager;
let trayManager: TrayManager;
let windowsManager: WindowsManager;

app.on("ready", async () => {
  app.dock?.hide();

  coreManager = new CoreManager(configPath, logPath);
  windowsManager = new WindowsManager();
  trayManager = new TrayManager(coreManager, windowsManager);

  trayManager.create();

  // Push live status updates to any open panel window
  coreManager.onStatus((payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("core-status-update", payload);
    });
  });

  try { await coreManager.start(); }
  catch (err) { console.error("[Anamnesis] Failed to start core daemon:", err); }
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("get-config-path", () => configPath);
ipcMain.handle("core-status", () => coreManager.payload);

ipcMain.handle("core-reindex", () => coreManager.reindex());
ipcMain.handle("core-pause", () => coreManager.pause());
ipcMain.handle("core-resume", () => coreManager.resume());
ipcMain.handle("core-flush", () => coreManager.flush());

ipcMain.handle("core-get-dirs", async () => {
  try {
    return await coreManager.getDirs();
  } catch {
    // Daemon not running — synthesise dir list from config file
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { watchDirs?: string[] };
      return (raw.watchDirs ?? []).map((p: string) => ({ path: p, paused: false, chunkCount: 0 }));
    } catch { return []; }
  }
});
ipcMain.handle("core-pause-dir", (_e, dir: string) => coreManager.pauseDir(dir));
ipcMain.handle("core-resume-dir", (_e, dir: string) => coreManager.resumeDir(dir));
ipcMain.handle("core-reindex-dir", (_e, dir: string) => coreManager.reindexDir(dir));

ipcMain.handle("mcp-start", () => coreManager.startMcp());
ipcMain.handle("mcp-stop", () => coreManager.stopMcp());

ipcMain.handle("get-vectors", () => coreManager.getVectors());

ipcMain.handle("get-config", async () => {
  try {
    return await coreManager.getConfig();
  } catch {
    // Daemon not ready yet — read config file directly so Settings/AddFolder work during startup
    try { return JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown; } catch { return {}; }
  }
});

ipcMain.handle("save-config", async (_e, partial: unknown) => {
  try {
    await coreManager.saveConfig(partial);
  } catch {
    // Daemon not running — write directly so changes persist and are picked up on next start
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>; } catch { /* first run */ }
    const updated = { ...existing, ...(partial as Record<string, unknown>) };
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf-8");
  }
});

ipcMain.handle("get-log-path", () => logPath);

ipcMain.handle("open-log-file", async () => {
  const { shell } = await import("electron");
  await shell.openPath(logPath);
});

ipcMain.handle("open-dir-dialog", async () => {
  const { dialog } = await import("electron");
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.filePaths[0] ?? null;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────────

app.on("before-quit", async () => {
  trayManager.destroy();
  await coreManager.stop();
});

app.on("window-all-closed", () => { /* suppress quit — tray keeps running */ });

app.on("second-instance", () => windowsManager.openPanel());
