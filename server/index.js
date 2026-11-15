import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeAudioStream } from './services/youtubeProxy.js';

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
