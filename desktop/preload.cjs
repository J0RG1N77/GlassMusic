const { contextBridge, ipcRenderer } = require('electron');

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
