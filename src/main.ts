import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

// Use LocalAppData (non-synced, no OneDrive conflict)
const USER_DATA = 'C:\\Users\\Lukdo\\AppData\\Local\\VoiceDeck';
app.setPath('userData', USER_DATA);
app.setPath('logs',     path.join(USER_DATA, 'logs'));

// Enable microphone access
app.commandLine.appendSwitch('enable-features', 'MediaFoundationAudioCapture');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let transcriber: any = null;

declare global {
  namespace Electron {
    interface App { isQuitting: boolean; }
  }
}
app.isQuitting = false;

// ---- Whisper in main process (Node.js filesystem, no IndexedDB) ----
async function loadWhisper(sender: Electron.WebContents) {
  const { pipeline, env } = await import('@xenova/transformers');

  // Use local AppData folder — no OneDrive, no permission issues
  env.cacheDir = path.join(USER_DATA, 'models');
  env.allowRemoteModels = true;
  env.useBrowserCache = false;

  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
  }

  transcriber = await (pipeline as any)(
    'automatic-speech-recognition',
    'Xenova/whisper-tiny',
    {
      progress_callback: (info: any) => {
        sender.send('whisper-progress', info);
      }
    }
  );
}

async function transcribeAudio(float32Buffer: ArrayBuffer): Promise<string> {
  if (!transcriber) throw new Error('Whisper not loaded');
  const audio = new Float32Array(float32Buffer);
  const result = await transcriber(audio, {
    language: 'portuguese',
    task: 'transcribe',
    chunk_length_s: 15,
  });
  return (result.text ?? '').trim();
}

// ---- Window ----
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 580,
    frame: false,
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    title: 'VoiceDeck',
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Grant microphone permission
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media');
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
};

const createTray = () => {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('VoiceDeck');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'VoiceDeck', enabled: false },
    { type: 'separator' },
    { label: 'Abrir Painel', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show());
};

// ---- App Ready ----
app.on('ready', () => {
  createWindow();
  createTray();

  // IPC: Load Whisper
  ipcMain.handle('load-whisper', async (event) => {
    try {
      await loadWhisper(event.sender);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // IPC: Transcribe audio (receives decoded Float32 PCM at 16kHz)
  ipcMain.handle('transcribe', async (event, buffer: ArrayBuffer) => {
    try {
      const text = await transcribeAudio(buffer);
      return { ok: true, text };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // IPC: Spotify auth
  ipcMain.handle('spotify-auth', async (event, authUrl: string) => {
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 620,
        show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      authWindow.loadURL(authUrl);

      let resolved = false;
      const checkUrl = (url: string, ev?: Electron.Event) => {
        if (resolved) return;
        if (
          url.includes('/callback') &&
          (url.includes('127.0.0.1:1420') || url.includes('localhost:1420'))
        ) {
          resolved = true;
          if (ev && typeof ev.preventDefault === 'function') {
            ev.preventDefault();
          }
          try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');
            const error = parsed.searchParams.get('error');
            setTimeout(() => {
              if (authWindow && !authWindow.isDestroyed()) {
                authWindow.destroy();
              }
            }, 100);
            if (code) resolve(code);
            else reject(error || 'Autenticação cancelada ou recusada.');
          } catch (err) {
            reject(err);
          }
        }
      };

      authWindow.webContents.on('will-redirect', (ev, url) => checkUrl(url, ev));
      authWindow.webContents.on('will-navigate', (ev, url) => checkUrl(url, ev));
      authWindow.webContents.on('will-frame-navigate', (details: any) => checkUrl(details.url));
      authWindow.webContents.on('did-start-navigation', (details: any) => checkUrl(details.url));

      authWindow.on('closed', () => {
        if (!resolved) {
          reject('Janela de login fechada pelo usuário.');
        }
      });
    });
  });

  // IPC: Window controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-close',    () => mainWindow?.hide());
});

app.on('window-all-closed', () => { /* keep alive in tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
