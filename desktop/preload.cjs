const { contextBridge, ipcRenderer } = require('electron');
const appVersion = ipcRenderer.sendSync('get-app-version') || '';

const mediaControls = {
  sendPlaybackState(isPlaying) {
    ipcRenderer.send('playback-state-changed', Boolean(isPlaying));
  },
  onMediaControl(listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, action) => listener(action);
    ipcRenderer.on('media-control', handler);
    return () => ipcRenderer.removeListener('media-control', handler);
  }
};

contextBridge.exposeInMainWorld('glassMusicVersion', {
  get() {
    return appVersion;
  }
});

contextBridge.exposeInMainWorld('glassMusicUpdater', {
  ...mediaControls,
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
  ...mediaControls,
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

contextBridge.exposeInMainWorld('glassMusicControls', mediaControls);

contextBridge.exposeInMainWorld('electronAPI', {
  toggleMiniPlayer(enable) {
    return ipcRenderer.invoke('player:toggle-mini', Boolean(enable));
  }
});
