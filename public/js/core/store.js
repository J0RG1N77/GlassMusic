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
  queueIndex: -1,
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
export { DEFAULT_SETTINGS };
