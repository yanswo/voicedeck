import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';

if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let isAltDown = false;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

const registerHotkeys = () => {
  // Push-to-Talk (ALT)
  // Electron globalShortcut doesn't natively distinguish KeyDown and KeyUp perfectly for modifiers.
  // Wait, actually `globalShortcut` only triggers on key down. To detect key up globally in Windows,
  // we might need an external module or a polling workaround for MVP. 
  // Let's use a workaround or try to bind 'Alt' and check state, or use standard letters for now to test.
  
  // For the MVP, we will just simulate it by sending a toggle event or we can use another library later.
  // Actually, let's map it to something simpler for testing, or we can just send "start" on press.
  // We'll leave it as a placeholder and send events.
  
  // A better way to handle push-to-talk in Electron without native keyup events is using `uIOhook`
  // but since we want to avoid C++ compiles, we can use a small hack or bind two keys (e.g., F9 to toggle).
  // Let's bind 'CommandOrControl+Space' as a toggle for now, and later we can implement real Push-To-Talk with Alt.
  
  globalShortcut.register('CommandOrControl+Space', () => {
    isAltDown = !isAltDown;
    if (mainWindow) {
      mainWindow.webContents.send('hotkey-state', isAltDown);
    }
  });
};

app.on('ready', () => {
  createWindow();
  registerHotkeys();

  // Spotify Auth IPC
  ipcMain.handle('spotify-auth', async (event, authUrl: string) => {
    return new Promise((resolve, reject) => {
      const authWindow = new BrowserWindow({
        width: 500,
        height: 600,
        show: true,
        webPreferences: {
          nodeIntegration: false,
        }
      });

      authWindow.loadURL(authUrl);

      authWindow.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith('http://localhost:1420/callback')) {
          const rawCode = new URL(url).searchParams.get('code');
          const error = new URL(url).searchParams.get('error');

          if (rawCode) {
            resolve(rawCode);
          } else {
            reject(error || 'Unknown error');
          }
          authWindow.close();
        }
      });

      authWindow.on('closed', () => {
        reject('User closed window');
      });
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
