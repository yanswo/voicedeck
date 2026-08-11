import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  spotifyAuth:      (url: string) => ipcRenderer.invoke('spotify-auth', url),
  loadWhisper:      () => ipcRenderer.invoke('load-whisper'),
  transcribe:       (buffer: ArrayBuffer) => ipcRenderer.invoke('transcribe', buffer),
  onWhisperProgress:(cb: (info: any) => void) => {
    ipcRenderer.on('whisper-progress', (_e, info) => cb(info));
  },
  minimize:     () => ipcRenderer.send('window-minimize'),
  closeWindow:  () => ipcRenderer.send('window-close'),
});
