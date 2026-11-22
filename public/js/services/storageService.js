const KEYS = {
  settings: 'glass_music_settings_v1',
  favorites: 'glass_music_favorites_v1',
  playlists: 'glass_music_playlists_v1',
  history: 'glass_music_history_v1'
};

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    console.warn(`Não foi possível ler ${key} do armazenamento local.`, error);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Não foi possível persistir ${key} no armazenamento local.`, error);
  }
}

export const storageService = {
  load() {
    return {
      settings: read(KEYS.settings, {}),
      favorites: read(KEYS.favorites, []),
      playlists: read(KEYS.playlists, []),
      history: read(KEYS.history, [])
    };
  },
  saveSettings(value) { write(KEYS.settings, value); },
  saveFavorites(value) { write(KEYS.favorites, value); },
  savePlaylists(value) { write(KEYS.playlists, value); },
  saveHistory(value) { write(KEYS.history, value.slice(0, 60)); },
  renamePlaylist(playlistId, newName) {
    const name = String(newName || '').trim();
    if (!playlistId || !name) return null;
    const playlists = read(KEYS.playlists, []);
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) return null;
    playlist.name = name;
    write(KEYS.playlists, playlists);
    return playlist;
  },
  removeTrackFromPlaylist(playlistId, trackIndex) {
    const playlists = read(KEYS.playlists, []);
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist || !Array.isArray(playlist.tracks)) return null;
    if (trackIndex < 0 || trackIndex >= playlist.tracks.length) return null;
    const removed = playlist.tracks.splice(trackIndex, 1)[0] || null;
    write(KEYS.playlists, playlists);
    return removed;
  },
  moveTrackInPlaylist(playlistId, fromIndex, toIndex) {
    const playlists = read(KEYS.playlists, []);
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist || !Array.isArray(playlist.tracks)) return false;
    if (fromIndex < 0 || toIndex < 0
      || fromIndex >= playlist.tracks.length
      || toIndex >= playlist.tracks.length) return false;
    const [track] = playlist.tracks.splice(fromIndex, 1);
    playlist.tracks.splice(toIndex, 0, track);
    write(KEYS.playlists, playlists);
    return true;
  },
  exportPlaylistCSV(playlistId) {
    const playlists = read(KEYS.playlists, []);
    const playlist = playlists.find((item) => item.id === playlistId);
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
  },
  sanitizeTrack(track) {
    return {
      trackId: track.trackId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSec: track.durationSec,
      artworkMedium: track.artworkMedium,
      artworkLarge: track.artworkLarge,
      previewUrl: track.previewUrl || '',
      explicit: Boolean(track.explicit)
    };
  }
};
