import { BrowserWindow, shell } from "electron";
import path from "path";

export class WindowsManager {
  private panelWindow: BrowserWindow | null = null;

  openPanel(): void {
    if (this.panelWindow && !this.panelWindow.isDestroyed()) {
      this.panelWindow.focus();
      return;
    }

    this.panelWindow = new BrowserWindow({
      width: 760,
      height: 680,
      minWidth: 600,
      minHeight: 520,
      title: "Anamnesis",
      backgroundColor: "#08070c",
      show: false,
      titleBarStyle: "hidden",
      // macOS: keep traffic lights, nudge them to align with our header padding
      ...(process.platform === "darwin" && {
        trafficLightPosition: { x: 12, y: 11 },
      }),
      // Windows: native caption buttons with Anvilmar purple-deep background
      ...(process.platform === "win32" && {
        titleBarOverlay: { color: "#1f1730", symbolColor: "#e8e4f0", height: 36 },
      }),
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.panelWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
    this.panelWindow.once("ready-to-show", () => this.panelWindow?.show());
    this.panelWindow.on("closed", () => { this.panelWindow = null; });

    this.panelWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
  }

  closeAll(): void {
    this.panelWindow?.close();
  }
}
