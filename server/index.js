import 'dotenv/config';
import dns from 'node:dns';
import cors from 'cors';
import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPrefetchStatus,
  pipeAudioStream,
  prefetchYouTubeStream
} from './services/youtubeProxy.js';
import { DISCOVERY_CATEGORIES, getDiscoveryCategory } from './services/discoveryService.js';

dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3001);

export function getYtDlpPath() {
  if (process.resourcesPath) {
    const packagedPath = path.join(process.resourcesPath, 'bin', 'yt-dlp.exe');
    if (existsSync(packagedPath)) return packagedPath;
  }

  const developmentPath = path.resolve(__dirname, '../desktop/bin/yt-dlp.exe');
  if (process.platform === 'win32' && existsSync(developmentPath)) return developmentPath;

  return 'yt-dlp';
}

process.env.YTDLP_PATH = getYtDlpPath();

app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve(__dirname, '../public')));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'glass-music-proxy' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'glass-music-proxy' }));
app.get('/api/version', (_req, res) => {
  try {
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
    return res.json({ version: packageJson.version || '' });
  } catch (error) {
    console.error('[version] Falha ao ler package.json:', error);
    return res.status(500).json({ error: 'Não foi possível obter a versão do aplicativo' });
  }
});
app.get('/api/image-proxy', async (req, res) => {
  const rawUrl = String(req.query.url || '').trim();
  let coverUrl;
  try {
    coverUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'invalid_image_url' });
  }

  const trustedHosts = [
    'dzcdn.net',
    'e-cdns-images.dzcdn.net',
    'mzstatic.com',
    'is1-ssl.mzstatic.com',
    'is2-ssl.mzstatic.com',
    'is3-ssl.mzstatic.com',
    'is4-ssl.mzstatic.com',
    'is5-ssl.mzstatic.com',
    'ytimg.com',
    'i.ytimg.com',
    'googleusercontent.com',
    'lh3.googleusercontent.com'
  ];
  const host = coverUrl.hostname.toLowerCase();
  const allowed = trustedHosts.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
  if (!allowed || !['http:', 'https:'].includes(coverUrl.protocol)) {
    return res.status(403).json({ error: 'image_host_not_allowed' });
  }

  try {
    const response = await fetch(coverUrl, {
      headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    if (!contentType.startsWith('image/')) throw new Error('URL não retornou uma imagem');
    const bytes = await response.arrayBuffer();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', contentType);
    return res.send(Buffer.from(bytes));
  } catch (error) {
    console.error('Falha em /api/image-proxy:', error);
    return res.status(502).json({ error: 'image_proxy_unavailable', message: error.message });
  }
});
app.get('/api/discover', async (req, res) => {
  const category = String(req.query.category || '').trim().toLowerCase();
  if (!DISCOVERY_CATEGORIES[category]) {
    return res.status(400).json({ error: 'invalid_category', category });
  }
  try {
    const tracks = await getDiscoveryCategory(category);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({ category, tracks });
  } catch (error) {
    console.error('Falha em /api/discover:', error);
    return res.status(502).json({ error: 'discover_unavailable', message: error.message });
  }
});
app.post('/api/prefetch', async (req, res) => {
  const artist = String(req.body?.artist || '').trim();
  const title = String(req.body?.title || '').trim();
  if (!artist || !title) {
    return res.status(400).json({ error: 'artist_and_title_required' });
  }
  try {
    const status = getPrefetchStatus({ artist, title });
    if (status === 'cached') return res.json({ status: 'cached' });
    if (status === 'prefetching') return res.json({ status: 'prefetching' });

    const resolution = prefetchYouTubeStream({ artist, title });
    void resolution.catch((error) => {
      console.error(`Falha no prefetch de "${artist} - ${title}":`, error);
    });
    return res.json({ status: 'prefetching' });
  } catch (error) {
    console.error('Falha em /api/prefetch:', error);
    return res.status(502).json({ error: 'prefetch_failed', message: error.message });
  }
});
app.get('/api/autoplay', async (req, res) => {
  const artist = String(req.query.artist || '').trim();
  const title = String(req.query.title || '').trim();
  if (!artist || !title) {
    return res.status(400).json({ error: 'artist_and_title_required' });
  }

  const excluded = new Set(
    String(req.query.exclude || '')
      .split(',')
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean)
  );
  excluded.add(title.toLocaleLowerCase());
  excluded.add(artist.toLocaleLowerCase());

  try {
    const rawTracks = [];
    const fetchJson = async (url) => {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return response.json();
    };

    const artistSearch = await fetchJson(
      `https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=5`
    );
    const artists = artistSearch?.data || [];
    const exactArtist = artists.find((item) => (
      item.name.toLocaleLowerCase() === artist.toLocaleLowerCase()
    )) || artists[0];

    if (exactArtist?.id) {
      const relatedPayload = await fetchJson(
        `https://api.deezer.com/artist/${exactArtist.id}/related?limit=8`
      );
      const relatedArtists = (relatedPayload?.data || []).slice(0, 4);
      const radioPayloads = await Promise.all(
        relatedArtists.map((related) =>
          fetchJson(`https://api.deezer.com/artist/${related.id}/radio?limit=12`)
        )
      );
      for (const payload of radioPayloads) {
        rawTracks.push(...(payload?.data || []));
      }
    }

    if (rawTracks.length < 8) {
      const fallbackPayload = await fetchJson(
        `https://api.deezer.com/search/track?q=${encodeURIComponent(`${artist} ${title}`)}&limit=15`
      );
      rawTracks.push(...(fallbackPayload?.data || []));
    }

    const tracks = [];
    const seen = new Set();
    for (const track of rawTracks) {
      const trackTitle = String(track.title || '').trim();
      const trackArtist = String(track.artist?.name || '').trim();
      if (!trackTitle || !trackArtist) continue;
      const key = `${trackArtist.toLocaleLowerCase()}::${trackTitle.toLocaleLowerCase()}`;
      if (seen.has(key) || excluded.has(key) || excluded.has(trackTitle.toLocaleLowerCase())) continue;
      if (trackArtist.toLocaleLowerCase() === artist.toLocaleLowerCase()) continue;
      seen.add(key);
      tracks.push({
        trackId: `deezer-${track.id}`,
        title: trackTitle,
        artist: trackArtist,
        album: track.album?.title || 'Deezer',
        cover: track.album?.cover_xl || track.album?.cover_big || '',
        artworkMedium: (track.album?.cover_big || track.album?.cover_xl || 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music'),
        artworkLarge: (track.album?.cover_xl || track.album?.cover_big || 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music'),
        duration: `${Math.floor((Number(track.duration) || 180) / 60)}:${String((Number(track.duration) || 180) % 60).padStart(2, '0')}`,
        durationSec: Math.max(1, Number(track.duration) || 180),
        previewUrl: track.preview || ''
      });
    }

    for (let i = tracks.length - 1; i > 0; i--) {
      if (Math.random() < 0.55) {
        const j = Math.floor(Math.random() * (i + 1));
        [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      }
    }
    const recommendations = tracks.slice(0, 8);
    const result = recommendations.length >= 5
      ? recommendations
      : recommendations.concat(tracks.slice(recommendations.length, 5));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ tracks: result.slice(0, 8) });
  } catch (error) {
    console.error('Falha em /api/autoplay:', error);
    return res.status(502).json({ error: 'autoplay_unavailable', message: error.message });
  }
});
app.post('/api/import-playlist', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  let spotifyUrl;
  try {
    spotifyUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_spotify_url' });
  }

  if (!['open.spotify.com', 'www.open.spotify.com'].includes(spotifyUrl.hostname)) {
    return res.status(400).json({ error: 'spotify_url_required' });
  }

  const parts = spotifyUrl.pathname.split('/').filter(Boolean);
  const playlistIndex = parts.findIndex((part) => part === 'playlist');
  const playlistId = playlistIndex >= 0 ? parts[playlistIndex + 1] : parts[0];
  if (!/^[A-Za-z0-9]+$/.test(playlistId || '')) {
    return res.status(400).json({ error: 'invalid_playlist_id' });
  }

  try {
    const embedResponse = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
      }
    });
    if (!embedResponse.ok) throw new Error(`Spotify retornou HTTP ${embedResponse.status}`);
    const html = await embedResponse.text();
    const scriptMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) throw new Error('Dados da playlist não encontrados no embed');

    let nextData;
    try {
      nextData = JSON.parse(scriptMatch[1]);
    } catch {
      throw new Error('JSON embutido da playlist é inválido');
    }

    const findValues = (value, keyName, matches = []) => {
      if (!value || typeof value !== 'object') return matches;
      if (Array.isArray(value)) {
        value.forEach((item) => findValues(item, keyName, matches));
        return matches;
      }
      for (const [key, child] of Object.entries(value)) {
        if (key.toLowerCase().includes(keyName.toLowerCase())) matches.push(child);
        findValues(child, keyName, matches);
      }
      return matches;
    };

    const trackLists = findValues(nextData, 'tracklist')
      .filter((item) => Array.isArray(item))
      .sort((a, b) => b.length - a.length);
    const rawTracks = trackLists[0] || [];
    if (rawTracks.length === 0) throw new Error('Nenhuma faixa encontrada na playlist');

    const normalizeDuration = (duration) => {
      const value = Number(duration);
      if (!Number.isFinite(value) || value <= 0) return 180;
      if (value > 10000) return Math.round(value / 1000);
      return Math.round(value);
    };

    let tracks = rawTracks.map((item, index) => {
      const title = item.title || item.name || item.track?.title || item.track?.name;
      const artists = item.artists || item.subtitle || item.track?.artists || item.track?.subtitle;
      let artist = '';
      if (Array.isArray(artists)) {
        artist = artists.map((value) => value.name || value).filter(Boolean).join(', ');
      } else {
        artist = typeof artists === 'string' ? artists : '';
      }
      if (!artist && item.artist) artist = item.artist.name || item.artist;
      if (!title) return null;
      const durationSec = normalizeDuration(item.duration || item.durationMs || item.track?.duration);
      const cover = item.coverArt?.sources?.[0]?.url
        || item.album?.cover
        || item.album?.images?.[0]?.url
        || item.track?.album?.images?.[0]?.url
        || '';
      return {
        trackId: `spotify-${item.uri?.split(':').pop() || item.id || `${artist}-${title}-${index}`}`,
        title: String(title).trim(),
        artist: String(artist || 'Artista desconhecido').trim(),
        album: item.album?.name || item.albumName || 'Spotify',
        cover,
        artworkMedium: cover,
        artworkLarge: cover,
        duration: `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`,
        durationSec,
        previewUrl: item.previewUrl || ''
      };
    }).filter(Boolean);

    const seen = new Set();
    tracks = tracks.filter((track) => {
      const key = `${track.artist.toLocaleLowerCase()}::${track.title.toLocaleLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const coverCandidates = findValues(nextData, 'cover')
      .map((value) => {
        if (typeof value === 'string') return value;
        if (value?.sources?.[0]?.url) return value.sources[0].url;
        return null;
      })
      .filter(Boolean);
    let cover = coverCandidates[0] || '';

    const nameCandidates = findValues(nextData, 'name')
      .filter((value) => typeof value === 'string' && value.trim())
      .filter((value) => !['Spotify', 'Top tracks'].includes(value));
    const name = nameCandidates[0] || 'Playlist importada';

    const missingCovers = tracks.filter((track) => !track.cover).slice(0, 25);
    if (missingCovers.length > 0) {
      await Promise.all(missingCovers.map(async (track) => {
        try {
          const response = await fetch(
            `https://api.deezer.com/search/track?q=${encodeURIComponent(`${track.artist} ${track.title}`)}&limit=1`
          );
          if (!response.ok) return;
          const payload = await response.json();
          const match = payload.data?.[0];
          const resolved = match?.album?.cover_xl || match?.album?.cover_big || '';
          if (resolved) {
            track.cover = resolved;
            track.artworkMedium = resolved;
            track.artworkLarge = resolved;
          }
        } catch {}
      }));
    }

    return res.json({ name, cover, tracks });
  } catch (error) {
    console.error('Falha em /api/import-playlist:', error);
    return res.status(502).json({ error: 'playlist_import_failed', message: error.message });
  }
});
app.get('/api/stream', async (req, res) => {
  try {
    await pipeAudioStream(req, res, req.query);
  } catch (error) {
    console.error('Falha em /api/stream:', error);
    if (!res.headersSent) res.status(502).json({ error: 'stream_unavailable', message: error.message });
  }
});
app.get('*', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/index.html')));

app.listen(port, () => console.log(`Glass Music server listening on http://localhost:${port}`));
