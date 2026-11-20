const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function getPackageVersion() {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
  } catch {
    return '';
  }
}

const appVersion = ipcRenderer.sendSync('get-app-version') || getPackageVersion();

contextBridge.exposeInMainWorld('glassMusicVersion', {
  get() {
    return appVersion;
  }
});

contextBridge.exposeInMainWorld('glassMusicUpdater', {
  onUpdateStatus(listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  restartAndInstall() {
    ipcRenderer.send('restart-and-install');
  },
  checkForUpdates() {
    ipcRenderer.send('check-for-updates');
  }
});

contextBridge.exposeInMainWorld('electronUpdater', {
  onUpdateStatus(listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  restartAndInstall() {
    ipcRenderer.send('restart-and-install');
  },
  checkForUpdates() {
    ipcRenderer.send('check-for-updates');
  }
});
