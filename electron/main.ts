import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { app, BrowserWindow, ipcMain } from "electron";

// ESM has no __dirname — derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDataPath(relativePath: string): string {
  return path.join(app.getPath("userData"), relativePath);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function handleExists(_event: Electron.IpcMainInvokeEvent, relativePath: string): boolean {
  return fs.existsSync(getDataPath(relativePath));
}

async function handleReadTextFile(_event: Electron.IpcMainInvokeEvent, relativePath: string): Promise<string> {
  return fs.promises.readFile(getDataPath(relativePath), "utf-8");
}

async function handleWriteTextFile(_event: Electron.IpcMainInvokeEvent, relativePath: string, contents: string): Promise<void> {
  await fs.promises.writeFile(getDataPath(relativePath), contents, "utf-8");
}

async function handleMkdir(_event: Electron.IpcMainInvokeEvent, relativePath: string): Promise<void> {
  await fs.promises.mkdir(getDataPath(relativePath), { recursive: true });
}

ipcMain.handle("fs:exists", handleExists);
ipcMain.handle("fs:readTextFile", handleReadTextFile);
ipcMain.handle("fs:writeTextFile", handleWriteTextFile);
ipcMain.handle("fs:mkdir", handleMkdir);

app.whenReady().then(createWindow);

app.on("window-all-closed", function onWindowAllClosed(): void {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function onActivate(): void {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
