import { BrowserWindow, shell } from "electron";
import path from "path";

export class WindowsManager {
  private settingsWindow: BrowserWindow | null = null;

  openSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus();
      return;
    }

    this.settingsWindow = new BrowserWindow({
      width: 820,
      height: 620,
      minWidth: 640,
      minHeight: 480,
      title: "Anamnesis Settings",
      backgroundColor: "#111111",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.settingsWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));

    this.settingsWindow.once("ready-to-show", () => {
      this.settingsWindow?.show();
    });

    this.settingsWindow.on("closed", () => {
      this.settingsWindow = null;
    });

    // Open external links in the default browser
    this.settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
  }

  closeAll(): void {
    this.settingsWindow?.close();
  }
}
