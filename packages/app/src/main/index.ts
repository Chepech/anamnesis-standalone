import { app, ipcMain } from "electron";
import path from "path";
import os from "os";
import { CoreManager } from "./core-manager.js";
import { TrayManager } from "./tray.js";
import { WindowsManager } from "./windows.js";

// ── Config path ───────────────────────────────────────────────────────────────

const configPath = app.isPackaged
  ? path.join(app.getPath("userData"), "config.json")
  : path.join(os.homedir(), ".config", "anamnesis-dev", "config.json");

// ── Single instance ───────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

let coreManager: CoreManager;
let trayManager: TrayManager;
let windowsManager: WindowsManager;

app.on("ready", async () => {
  // Tray-only app — no dock icon on macOS
  app.dock?.hide();

  coreManager = new CoreManager(configPath);
  windowsManager = new WindowsManager();
  trayManager = new TrayManager(coreManager, windowsManager);

  trayManager.create();

  // Start core daemon
  try {
    await coreManager.start();
  } catch (err) {
    console.error("[Anamnesis] Failed to start core daemon:", err);
  }
});

// ── IPC ────────────────────────────────────────────────────────────────────────

ipcMain.handle("get-config-path", () => configPath);
ipcMain.handle("core-reindex", () => coreManager.reindex());
ipcMain.handle("core-pause", () => coreManager.pause());
ipcMain.handle("core-resume", () => coreManager.resume());
ipcMain.handle("core-status", () => ({ status: coreManager.status }));

// ── Lifecycle ──────────────────────────────────────────────────────────────────

app.on("before-quit", async () => {
  trayManager.destroy();
  await coreManager.stop();
});

// Prevent default Electron quit-on-all-windows-closed behavior
app.on("window-all-closed", (e: Event) => e.preventDefault());

// Restore tray if second instance attempts to launch
app.on("second-instance", () => {
  windowsManager.openSettings();
});
