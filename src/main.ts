import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, session } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

// Fix disk cache path to prevent cache corruption that breaks Web Speech API networking
app.setPath('userData', path.join(app.getPath('appData'), 'VoiceDeck'));

// Enable Web Speech API + microphone access in Electron
app.commandLine.appendSwitch('enable-features', 'MediaFoundationAudioCapture,WebSpeechAPI');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-features', 'AutoupgradeMixedContent');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

declare global {
  namespace Electron {
    interface App {
      isQuitting: boolean;
    }
  }
}
app.isQuitting = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 600,
    frame: false,       // Frameless for premium feel
    transparent: false,
    backgroundColor: '#0f0f13',
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

  // Grant microphone permission automatically
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Prevent closing — hide to tray instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
    return false;
  });
};

const createTray = () => {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  
  const updateMenu = () => Menu.buildFromTemplate([
    { label: 'VoiceDeck', enabled: false },
    { type: 'separator' },
    { label: 'Abrir Painel', click: () => mainWindow?.show() },
    { type: 'separator' },
    { 
      label: 'Sair', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('VoiceDeck');
  tray.setContextMenu(updateMenu());
  
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow?.hide() : mainWindow?.show();
  });
};

const registerHotkeys = () => {
  // Ctrl+Space as toggle push-to-talk (will-improve with J key in renderer)
  // We don't register anything global for now since the J key works per-window
  // and avoids conflicts while gaming. This keeps it simple.
};

app.on('ready', () => {
  createWindow();
  createTray();
  registerHotkeys();

  // Spotify Auth IPC
  ipcMain.handle('spotify-auth', async (event, authUrl: string) => {
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 620,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      });

      authWindow.loadURL(authUrl);

      const handleRedirect = (event: Electron.Event, url: string) => {
        if (url.startsWith('http://127.0.0.1:1420/callback')) {
          event.preventDefault();
          const rawCode = new URL(url).searchParams.get('code');
          const error = new URL(url).searchParams.get('error');

          if (rawCode) {
            resolve(rawCode);
          } else {
            reject(error || 'Unknown error');
          }
          
          // Remove listeners before closing to avoid double-reject
          authWindow.webContents.removeListener('will-redirect', handleRedirect as any);
          authWindow.webContents.removeListener('will-navigate', handleRedirect as any);
          authWindow.destroy();
        }
      };

      authWindow.webContents.on('will-redirect', handleRedirect);
      authWindow.webContents.on('will-navigate', handleRedirect);

      authWindow.on('closed', () => {
        reject('User closed window');
      });
    });
  });

  // IPC for window controls (frameless)
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-close', () => mainWindow?.hide());
});

app.on('window-all-closed', () => {
  // Do nothing — keep app alive in tray
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
