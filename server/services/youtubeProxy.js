import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import yts from 'yt-search';

const execFileAsync = promisify(execFile);
const DURATION_TOLERANCE_SECONDS = 5;
const DIRECT_URL_CACHE_TTL_MS = 30 * 60 * 1000;
const directUrlCache = new Map();

function isTopicChannel(channelTitle = '') {
  return /-\s*topic\b/i.test(channelTitle);
}

function durationMatches(videoDuration, requestedDuration) {
  return Number.isFinite(requestedDuration)
    && Math.abs(videoDuration - requestedDuration) <= DURATION_TOLERANCE_SECONDS;
}

function cacheKey(url) {
  return url;
}

function removeExpiredCacheEntries(now = Date.now()) {
  for (const [key, value] of directUrlCache) {
    if (value.expiresAt <= now) directUrlCache.delete(key);
  }
}

async function extractDirectAudioUrl(videoUrl) {
  removeExpiredCacheEntries();
  const key = cacheKey(videoUrl);
  const cached = directUrlCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const executable = await findYtDlpExecutable();
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--dump-single-json',
    '--format', 'bestaudio[ext=webm]/bestaudio/best',
    videoUrl
  ];
  if (process.env.YOUTUBE_COOKIES) {
    args.unshift('--cookies', process.env.YOUTUBE_COOKIES);
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync(executable, args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }));
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`yt-dlp não conseguiu extrair o áudio: ${detail}`);
  }

  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    throw new Error('yt-dlp retornou metadados inválidos');
  }
  if (!metadata.url) throw new Error('yt-dlp não retornou uma URL direta de áudio');

  const result = {
    url: metadata.url,
    contentType: metadata.mime_type || 'audio/webm',
    expiresAt: Date.now() + DIRECT_URL_CACHE_TTL_MS
  };
  directUrlCache.set(key, result);
  return result;
}

async function findYtDlpExecutable() {
  const configured = process.env.YTDLP_PATH;
  const candidates = [
    configured,
    'yt-dlp',
    process.env.APPDATA && path.join(process.env.APPDATA, 'Python', 'Python315', 'Scripts', 'yt-dlp.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'yt-dlp', 'yt-dlp.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'yt-dlp', 'yt-dlp.exe')
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'yt-dlp') {
      try {
        await execFileAsync('where.exe', ['yt-dlp'], { windowsHide: true });
        return candidate;
      } catch {
        continue;
      }
    }
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('yt-dlp não encontrado. Instale-o no PATH ou configure YTDLP_PATH no arquivo .env');
}

export async function resolveYouTubeStream({ artist, title, duration }) {
  if (!artist || !title) throw new Error('artist e title são obrigatórios');
  const requestedDuration = Number(duration);
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    throw new Error('duration inválida');
  }

  const results = await yts.search(`${artist} ${title}`);
  const candidates = (results.videos || [])
    .filter((video) => durationMatches(video.seconds, requestedDuration))
    .sort((a, b) => Number(isTopicChannel(b.author?.name)) - Number(isTopicChannel(a.author?.name)));
  const selected = candidates[0];
  if (!selected?.url) throw new Error('Nenhum vídeo compatível encontrado');

  return {
    ...await extractDirectAudioUrl(selected.url),
    sourceUrl: selected.url,
    title: selected.title
  };
}

export async function pipeAudioStream(req, res, query) {
  const resolved = await resolveYouTubeStream(query);
  const headers = {
    'X-Audio-Quality': req.headers['x-audio-quality'] || 'opus-160kbps'
  };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream = await fetch(resolved.url, { headers });
  if (upstream.status === 403) {
    directUrlCache.delete(cacheKey(resolved.sourceUrl));
    const refreshed = await extractDirectAudioUrl(resolved.sourceUrl);
    upstream = await fetch(refreshed.url, { headers });
  }
  if (!upstream.ok && upstream.status !== 206) {
    throw new Error(`YouTube respondeu ${upstream.status}`);
  }

  res.status(upstream.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', resolved.contentType.split(';')[0]);
  for (const header of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', 'no-store');
  if (!upstream.body) throw new Error('Resposta do YouTube não possui corpo de áudio');

  for await (const chunk of upstream.body) {
    if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve));
  }
  res.end();
}

export function getDirectUrlCacheSize() {
  removeExpiredCacheEntries();
  return directUrlCache.size;
}
