import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';

const SERVER_PORT = 3001;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

let mainWindow;

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
    backgroundColor: '#0a0a0f',
    title: 'Glass Music',
    icon: 'desktop/icon.ico',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  };
  if (existsSync(iconPath)) options.icon = iconPath;

  mainWindow = new BrowserWindow(options);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.loadURL(SERVER_URL);
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