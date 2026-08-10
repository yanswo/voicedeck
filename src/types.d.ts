/// <reference types="vite/client" />

export interface IElectronAPI {
  spotifyAuth: (url: string) => Promise<string>;
  onHotkey: (callback: (isDown: boolean) => void) => void;
  removeAllListeners: () => void;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
