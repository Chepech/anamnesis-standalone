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
      backgroundColor: "#0e0e10",
      show: false,
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

    // Remove default menu bar
    this.panelWindow.setMenuBarVisibility(false);
  }

  closeAll(): void {
    this.panelWindow?.close();
  }
}
