const DEFAULT_BACKEND_URL = typeof window !== 'undefined' && window.location.protocol === 'https:'
  ? window.location.origin
  : 'http://localhost:3001';

const DEFAULT_SETTINGS = Object.freeze({
  accentColor: '#38bdf8',
  glassAlpha: 0.44,
  glassBlur: 24,
  oledMode: false,
  backendUrl: DEFAULT_BACKEND_URL
});

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  favorites: [],
  playlists: [],
  history: [],
  currentTrack: null,
  displayedTracks: [],
  queue: [],
  priorityQueue: [],
  queueIndex: -1,
  isQueueOpen: false,
  isPlaying: false,
  backendOnline: null
};

const listeners = new Set();
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function updateState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state));
}

export function renamePlaylist(playlistId, newName) {
  const name = String(newName || '').trim();
  if (!playlistId || !name) return null;
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return null;
  playlist.name = name;
  try {
    localStorage.setItem('glass_music_playlists_v1', JSON.stringify(state.playlists));
  } catch {}
  listeners.forEach((listener) => listener(state));
  return playlist;
}

export function removeTrackFromPlaylist(playlistId, trackIndex) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist || trackIndex < 0 || trackIndex >= playlist.tracks.length) return null;
  const [removed] = playlist.tracks.splice(trackIndex, 1);
  try {
    localStorage.setItem('glass_music_playlists_v1', JSON.stringify(state.playlists));
  } catch {}
  listeners.forEach((listener) => listener(state));
  return removed || null;
}

export function moveTrackInPlaylist(playlistId, fromIndex, toIndex) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist || fromIndex < 0 || toIndex < 0
    || fromIndex >= playlist.tracks.length
    || toIndex >= playlist.tracks.length) return false;
  const [track] = playlist.tracks.splice(fromIndex, 1);
  playlist.tracks.splice(toIndex, 0, track);
  try {
    localStorage.setItem('glass_music_playlists_v1', JSON.stringify(state.playlists));
  } catch {}
  listeners.forEach((listener) => listener(state));
  return true;
}

export function exportPlaylistCSV(playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return false;
  const escapeCSV = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
  const rows = [
    'Track Name,Artist Name,Album Name',
    ...(playlist.tracks || []).map((track) =>
      [track.title, track.artist, track.album].map(escapeCSV).join(',')
    )
  ];
  const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(playlist.name || 'playlist').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
export { DEFAULT_SETTINGS };
