import { app, BrowserWindow, ipcMain, nativeImage, screen, shell } from 'electron';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let mainWindow;
let savedWindowBounds = null;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;
autoUpdater.allowDowngrade = false;
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'J0RG1N77',
  repo: 'GlassMusic'
});
autoUpdater.logger = console;

ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

function createNativeControlIcon(icon) {
  const width = 32;
  const height = 32;
  const bitmap = Buffer.alloc(width * height * 4);
  const setPixel = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 4;
    bitmap[offset] = 255;
    bitmap[offset + 1] = 255;
    bitmap[offset + 2] = 255;
    bitmap[offset + 3] = 255;
  };
  const drawBar = (x) => {
    for (let y = 8; y < 24; y += 1) {
      for (let offset = -1; offset <= 1; offset += 1) setPixel(x + offset, y);
    }
  };
  const drawTriangle = (direction) => {
    for (let row = 0; row < 16; row += 1) {
      const extent = (row <= 8 ? row : 16 - row) * 2;
      const start = direction === 'right' ? 8 : 24 - extent;
      const end = direction === 'right' ? 8 + extent : 24;
      for (let x = start; x <= end; x += 1) setPixel(x, 8 + row);
    }
  };

  if (icon === 'prev') {
    drawBar(7);
    drawTriangle('left');
  } else if (icon === 'play') {
    drawTriangle('right');
  } else if (icon === 'pause') {
    drawBar(11);
    drawBar(20);
  } else if (icon === 'next') {
    drawTriangle('right');
    drawBar(25);
  }

  const image = nativeImage.createFromBitmap(bitmap, { width, height });
  return image.isEmpty() ? null : image;
}

function updateThumbarButtons(isPlaying = false) {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;

  const buttons = [
    {
      tooltip: 'Anterior',
      icon: createNativeControlIcon('prev'),
      click() {
        mainWindow?.webContents.send('media-control', 'prev');
      }
    },
    {
      tooltip: isPlaying ? 'Pausar' : 'Reproduzir',
      icon: createNativeControlIcon(isPlaying ? 'pause' : 'play'),
      click() {
        mainWindow?.webContents.send('media-control', 'toggle-play');
      }
    },
    {
      tooltip: 'Próxima',
      icon: createNativeControlIcon('next'),
      click() {
        mainWindow?.webContents.send('media-control', 'next');
      }
    }
  ].filter((button) => button.icon && !button.icon.isEmpty());

  mainWindow.setThumbarButtons(buttons);
}

ipcMain.on('playback-state-changed', (_event, isPlaying) => {
  updateThumbarButtons(Boolean(isPlaying));
});

function sendUpdateStatus(status, data = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('update-status', { status, ...data });
}

autoUpdater.on('checking-for-update', () => {
  console.log('[updater] Verificando atualizações...');
  sendUpdateStatus('checking', { currentVersion: app.getVersion() });
});
autoUpdater.on('update-available', (info) => {
  console.log('[updater] Atualização disponível:', info.version);
  sendUpdateStatus('update-available', { version: info.version, currentVersion: app.getVersion() });
});
autoUpdater.on('update-not-available', (info) => {
  console.log('[updater] Nenhuma atualização disponível:', info.version);
  sendUpdateStatus('update-not-available', { version: info.version, currentVersion: app.getVersion() });
});
autoUpdater.on('download-progress', (progress) => sendUpdateStatus('download-progress', {
  percent: progress.percent,
  transferred: progress.transferred,
  total: progress.total,
  bytesPerSecond: progress.bytesPerSecond
}));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('update-downloaded', { version: info.version }));
autoUpdater.on('error', (error) => {
  console.error('[updater] Erro:', error);
  sendUpdateStatus('error', { message: error?.message || String(error) });
});

ipcMain.on('restart-and-install', () => {
  if (app.isPackaged) autoUpdater.quitAndInstall();
});

async function checkForUpdates() {
  if (!app.isPackaged) {
    sendUpdateStatus('development', { message: 'Atualizações disponíveis apenas na versão instalada.' });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('[updater] Falha ao verificar:', error);
    sendUpdateStatus('error', { message: error?.message || String(error) });
  }
}

ipcMain.on('check-for-updates', () => {
  void checkForUpdates();
});

ipcMain.handle('player:toggle-mini', (_event, enable) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  if (Boolean(enable)) {
    savedWindowBounds = mainWindow.isMaximized()
      ? { x: 20, y: 20, width: 1200, height: 800 }
      : mainWindow.getBounds();
    if (mainWindow.isMaximized()) mainWindow.unmaximize();

    const workArea = screen.getDisplayMatching(savedWindowBounds).workArea;
    const width = 360;
    const height = 118;

    mainWindow.setMinimumSize(width, height);
    mainWindow.setContentSize(width, height);
    const compactBounds = mainWindow.getBounds();
    const x = workArea.x + workArea.width - compactBounds.width - 20;
    const y = workArea.y + workArea.height - compactBounds.height - 20;
    mainWindow.setPosition(x, y);
    mainWindow.setResizable(false);
    mainWindow.setAlwaysOnTop(true, 'floating');
    return true;
  }

  mainWindow.setAlwaysOnTop(false);
  mainWindow.setResizable(true);
  mainWindow.setMinimumSize(900, 620);

  if (savedWindowBounds) {
    mainWindow.setBounds(savedWindowBounds);
  } else {
    const { workArea } = screen.getPrimaryDisplay();
    mainWindow.setBounds({
      x: workArea.x + Math.round((workArea.width - 1200) / 2),
      y: workArea.y + Math.round((workArea.height - 800) / 2),
      width: 1200,
      height: 800
    });
  }
  return true;
});

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${SERVER_URL}/api/health`, { cache: 'no-store' });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`O servidor Glass Music não iniciou a tempo: ${lastError?.message || 'sem resposta'}`);
}

async function startServer() {
  process.env.PORT = String(SERVER_PORT);
  await import('../server/index.js');
  await waitForServer();
}

function createWindow() {
  const iconPath = path.join(app.getAppPath(), 'public', 'icons', 'icon-512.png');
  const options = {
    width: 1200,
    height: 800,
    minWidth: 400,
    minHeight: 650,
    autoHideMenuBar: true,
    backgroundColor: '#050507',
    show: false,
    title: 'Glass Music',
    icon: 'desktop/icon.ico',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  };
  if (existsSync(iconPath)) options.icon = iconPath;

  mainWindow = new BrowserWindow(options);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(SERVER_URL);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
  });
  mainWindow.webContents.once('did-finish-load', () => {
    updateThumbarButtons(false);
    if (!app.isPackaged) return;
    setTimeout(() => {
      void checkForUpdates();
    }, 4000);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (error) {
    console.error('Falha ao iniciar o Glass Music Desktop:', error);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});