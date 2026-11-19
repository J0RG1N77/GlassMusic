import 'dotenv/config';
import dns from 'node:dns';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeAudioStream } from './services/youtubeProxy.js';
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
app.use(express.static(path.resolve(__dirname, '../public')));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'glass-music-proxy' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'glass-music-proxy' }));
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
