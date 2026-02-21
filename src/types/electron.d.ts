interface ElectronAPI {
  exists(relativePath: string): Promise<boolean>;
  readTextFile(relativePath: string): Promise<string>;
  writeTextFile(relativePath: string, contents: string): Promise<void>;
  mkdir(relativePath: string): Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
