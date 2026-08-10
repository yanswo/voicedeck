import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  spotifyAuth: (authUrl: string) => ipcRenderer.invoke('spotify-auth', authUrl),
  onHotkey: (callback: (isDown: boolean) => void) => {
    ipcRenderer.on('hotkey-state', (_event, isDown) => callback(isDown));
  },
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('hotkey-state');
  }
});
