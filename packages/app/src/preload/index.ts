import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("anamnesisAPI", {
  getConfigPath: () => ipcRenderer.invoke("get-config-path") as Promise<string>,
  reindex: () => ipcRenderer.invoke("core-reindex") as Promise<void>,
  pause: () => ipcRenderer.invoke("core-pause") as Promise<void>,
  resume: () => ipcRenderer.invoke("core-resume") as Promise<void>,
  getStatus: () => ipcRenderer.invoke("core-status") as Promise<{ status: string }>,
  onStatus: (cb: (payload: unknown) => void) => {
    ipcRenderer.on("core-status-update", (_event, payload) => cb(payload));
    return () => ipcRenderer.removeAllListeners("core-status-update");
  },
});
