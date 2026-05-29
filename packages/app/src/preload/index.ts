import { contextBridge, ipcRenderer } from "electron";

const api = {
  getConfigPath: () => ipcRenderer.invoke("get-config-path") as Promise<string>,
  getStatus: () => ipcRenderer.invoke("core-status"),

  // Index controls (mirror plugin menu)
  reindex: () => ipcRenderer.invoke("core-reindex"),
  pause: () => ipcRenderer.invoke("core-pause"),
  resume: () => ipcRenderer.invoke("core-resume"),
  flush: () => ipcRenderer.invoke("core-flush"),

  // Per-folder
  getDirs: () => ipcRenderer.invoke("core-get-dirs"),
  pauseDir: (dir: string) => ipcRenderer.invoke("core-pause-dir", dir),
  resumeDir: (dir: string) => ipcRenderer.invoke("core-resume-dir", dir),
  reindexDir: (dir: string) => ipcRenderer.invoke("core-reindex-dir", dir),

  // MCP
  startMcp: () => ipcRenderer.invoke("mcp-start"),
  stopMcp: () => ipcRenderer.invoke("mcp-stop"),

  // Graph
  getVectors: () => ipcRenderer.invoke("get-vectors"),

  // Folder picker
  openDirDialog: () => ipcRenderer.invoke("open-dir-dialog") as Promise<string | null>,

  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (partial: unknown) => ipcRenderer.invoke("save-config", partial),

  // Log
  getLogPath: () => ipcRenderer.invoke("get-log-path") as Promise<string>,
  openLogFile: () => ipcRenderer.invoke("open-log-file") as Promise<void>,

  // Live status stream
  onStatusUpdate: (cb: (payload: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on("core-status-update", handler);
    return () => ipcRenderer.removeListener("core-status-update", handler);
  },
};

contextBridge.exposeInMainWorld("anamnesis", api);

// Type declaration for renderer consumption
declare global {
  interface Window {
    anamnesis: typeof api;
  }
}
