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
  sanitizeTrack(track) {
    return {
      trackId: track.trackId,
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSec: track.durationSec,
      artworkMedium: track.artworkMedium,
      artworkLarge: track.artworkLarge,
      previewUrl: track.previewUrl || ''
    };
  }
};
