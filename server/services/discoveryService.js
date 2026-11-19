const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;
const discoveryCache = new Map();

export const DISCOVERY_CATEGORIES = {
  'em-alta-brasil': {
    url: 'https://api.deezer.com/search/playlist?q=Top+Brasil&limit=1',
    source: 'deezer-playlist'
  },
  'pop-internacional': {
    url: 'https://api.deezer.com/chart/132/tracks?limit=25',
    source: 'deezer'
  },
  'lofi-chill': {
    url: 'https://api.deezer.com/search/track?q=lofi+chill+beats&limit=25',
    source: 'deezer'
  },
  'sertanejo': {
    url: 'https://api.deezer.com/chart/75/tracks?limit=25',
    source: 'deezer'
  },
  'eletronica': {
    url: 'https://api.deezer.com/chart/113/tracks?limit=25',
    source: 'deezer'
  },
  'rock-classico': {
    url: 'https://api.deezer.com/chart/152/tracks?limit=25',
    source: 'deezer'
  },
  'rb-soul': {
    url: 'https://api.deezer.com/chart/165/tracks?limit=25',
    source: 'deezer'
  }
};

const STATIC_FALLBACKS = {
  'em-alta-brasil': [
    ['Música Popular', 'Jota?'], ['Tá OK', 'Dennis & MC Kevin o Chris'],
    ['Erro Gostoso', 'Simone Mendes'], ['Funk Rave', 'Dennis & MC Taya']
  ],
  'pop-internacional': [
    ['Blinding Lights', 'The Weeknd'], ['As It Was', 'Harry Styles'],
    ['Die With A Smile', 'Lady Gaga & Bruno Mars'], ['APT.', 'Rosé & Bruno Mars']
  ],
  'lofi-chill': [
    ['Snowfall', 'Øneheart'], ['Weightless', 'Marconi Union'],
    ['Coffee Breath', 'Sofie Kähr'], ['A Walk', 'Tycho']
  ],
  'sertanejo': [
    ['Ao Vivo e a Cores', 'Matheus & Kauan'], ['Boiadeira', 'Ana Castela'],
    ['Facas', 'Diego & Victor Hugo'], ['Haverá Uma Festa', 'Henrique & Juliano']
  ],
  'eletronica': [
    ['Midnight', 'Tropical'], ['Titanium', 'David Guetta & Sia'],
    ['Something Just Like This', 'The Chainsmokers & Coldplay'], ['Levels', 'Avicii']
  ],
  'rock-classico': [
    ['Bohemian Rhapsody', 'Queen'], ['Stairway to Heaven', 'Led Zeppelin'],
    ['Comfortably Numb', 'Pink Floyd'], ['Dream On', 'Aerosmith']
  ],
  'rb-soul': [
    ['Blinding Lights', 'The Weeknd'], ['Dreams', 'Fleetwood Mac'],
    ['Redbone', 'Childish Gambino'], ['Come As You Are', 'Nirvana']
  ]
};

function formatDuration(seconds) {
  const safeSeconds = Math.max(1, Math.round(Number(seconds) || 180));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function normalizeTrack(track, source, index) {
  if (source === 'apple') {
    const title = track.name || track.title;
    const artist = track.artistName || track.artist;
    if (!title || !artist) return null;
    const cover = (track.artworkUrl100 || track.artworkUrl || '')
      .replace(/100x100bb|200x200bb/, '1000x1000bb');
    const durationSec = 180;
    return {
      trackId: `apple-${track.id || track.url || `${artist}-${title}-${index}`}`,
      title,
      artist,
      album: track.collectionName || 'Apple Music',
      cover: cover || 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
      artworkMedium: cover || 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music',
      artworkLarge: cover || 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
      duration: formatDuration(durationSec),
      durationSec,
      query: `${artist} ${title}`,
      previewUrl: track.previewUrl || ''
    };
  }

  const title = track.title;
  const artist = track.artist?.name;
  if (!title || !artist) return null;
  const durationSec = Math.max(1, Number(track.duration) || 180);
  const cover = track.album?.cover_xl
    || track.album?.cover_big
    || track.artist?.picture_xl
    || 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music';
  return {
    trackId: `deezer-${track.id || `${artist}-${title}-${index}`}`,
    title,
    artist,
    album: track.album?.title || 'Deezer',
    cover,
    artworkMedium: cover.replace('1000x1000', '600x600'),
    artworkLarge: cover,
    duration: formatDuration(durationSec),
    durationSec,
    query: `${artist} ${title}`,
    previewUrl: track.preview || ''
  };
}

function getStaticFallback(category) {
  return (STATIC_FALLBACKS[category] || []).map(([title, artist], index) => {
    const durationSec = 180 + index * 5;
    return {
      trackId: `fallback-${category}-${index}-${title}`,
      title,
      artist,
      album: 'Fallback',
      cover: 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
      artworkMedium: 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music',
      artworkLarge: 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
      duration: formatDuration(durationSec),
      durationSec,
      query: `${artist} ${title}`,
      previewUrl: ''
    };
  });
}

function uniqueTracks(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (!track) return false;
    const key = `${track.artist.trim().toLocaleLowerCase('pt-BR')}::${track.title.trim().toLocaleLowerCase('pt-BR')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDiscoveryCategory(category) {
  const config = DISCOVERY_CATEGORIES[category];
  if (!config) return null;

  const now = Date.now();
  const cached = discoveryCache.get(category);
  if (cached && cached.expiresAt > now) return cached.tracks;

  try {
    const payload = await fetchJson(config.url);
    let rawTracks;
    if (config.source === 'apple') {
      rawTracks = payload.feed?.results || [];
    } else if (config.source === 'deezer-playlist') {
      const playlist = payload.data?.[0];
      if (!playlist?.id) throw new Error('Playlist Top Brasil não encontrada');
      const playlistPayload = await fetchJson(`https://api.deezer.com/playlist/${playlist.id}/tracks?limit=25`);
      rawTracks = playlistPayload.data || playlistPayload.tracks?.data || [];
    } else {
      rawTracks = payload.data || payload.tracks?.data || [];
    }
    const tracks = rawTracks
      .map((track, index) => normalizeTrack(track, config.source, index))
      .filter(Boolean)
      .slice(0, 25);
    const unique = category === 'sertanejo' ? uniqueTracks(tracks).slice(0, 25) : tracks.slice(0, 25);
    const result = unique.length > 0 ? unique : getStaticFallback(category);
    discoveryCache.set(category, { tracks: result, expiresAt: now + DISCOVERY_TTL_MS });
    return result;
  } catch (error) {
    const fallback = getStaticFallback(category);
    discoveryCache.set(category, { tracks: fallback, expiresAt: now + DISCOVERY_TTL_MS });
    return fallback;
  }
}

export function invalidateDiscoveryCategory(category) {
  return discoveryCache.delete(category);
}

invalidateDiscoveryCategory('mpb-bossa');
invalidateDiscoveryCategory('sertanejo');
invalidateDiscoveryCategory('em-alta-brasil');

export function getDiscoveryCacheSize() {
  const now = Date.now();
  for (const [category, value] of discoveryCache) {
    if (value.expiresAt <= now) discoveryCache.delete(category);
  }
  return discoveryCache.size;
}
