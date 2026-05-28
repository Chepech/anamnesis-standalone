import { app, ipcMain, BrowserWindow } from "electron";
import path from "path";
import os from "os";
import { CoreManager } from "./core-manager.js";
import { TrayManager } from "./tray.js";
import { WindowsManager } from "./windows.js";

const configPath = app.isPackaged
  ? path.join(app.getPath("userData"), "config.json")
  : path.join(os.homedir(), ".config", "anamnesis-dev", "config.json");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let coreManager: CoreManager;
let trayManager: TrayManager;
let windowsManager: WindowsManager;

app.on("ready", async () => {
  app.dock?.hide();

  coreManager = new CoreManager(configPath);
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

ipcMain.handle("core-get-dirs", () => coreManager.getDirs());
ipcMain.handle("core-pause-dir", (_e, dir: string) => coreManager.pauseDir(dir));
ipcMain.handle("core-resume-dir", (_e, dir: string) => coreManager.resumeDir(dir));
ipcMain.handle("core-reindex-dir", (_e, dir: string) => coreManager.reindexDir(dir));

ipcMain.handle("mcp-start", () => coreManager.startMcp());
ipcMain.handle("mcp-stop", () => coreManager.stopMcp());

ipcMain.handle("get-vectors", () => coreManager.getVectors());

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
