import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  exists(relativePath: string): Promise<boolean> {
    return ipcRenderer.invoke("fs:exists", relativePath);
  },
  readTextFile(relativePath: string): Promise<string> {
    return ipcRenderer.invoke("fs:readTextFile", relativePath);
  },
  writeTextFile(relativePath: string, contents: string): Promise<void> {
    return ipcRenderer.invoke("fs:writeTextFile", relativePath, contents);
  },
  mkdir(relativePath: string): Promise<void> {
    return ipcRenderer.invoke("fs:mkdir", relativePath);
  },
});
