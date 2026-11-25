import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import yts from 'yt-search';

const execFileAsync = promisify(execFile);
const DURATION_TOLERANCE_SECONDS = 5;
const DIRECT_URL_CACHE_TTL_MS = 30 * 60 * 1000;
const PREFETCH_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const directUrlCache = new Map();
const resolvedStreamCache = new Map();
const inFlightPromises = new Map();

function normalizeTrackQuery(artist, title) {
  return `${String(artist || '').trim().normalize('NFKC').toLocaleLowerCase('pt-BR')} - ${String(title || '').trim().normalize('NFKC').toLocaleLowerCase('pt-BR')}`;
}

function removeExpiredResolvedEntries(now = Date.now()) {
  for (const [key, value] of resolvedStreamCache) {
    if (value.expiresAt <= now) resolvedStreamCache.delete(key);
  }
}

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
    '-4',
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--dump-single-json',
    '--format', 'bestaudio/best',
    videoUrl
  ];
  const jsArgs = ['--js-runtimes', 'node', '--remote-components', 'ejs:github'];
  const commandArgs = [...jsArgs, ...args];
  if (process.env.YOUTUBE_COOKIES) {
    commandArgs.unshift('--cookies', process.env.YOUTUBE_COOKIES);
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync(executable, commandArgs, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 25_000,
      windowsHide: true
    }));
  } catch (error) {
    const detail = error.stderr?.trim() || error.message;
    if (/unknown option|no such option/i.test(detail) && /--js-runtimes|--remote-components/.test(detail)) {
      try {
        ({ stdout } = await execFileAsync(executable, args, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 25_000,
          windowsHide: true
        }));
      } catch (fallbackError) {
        const fallbackDetail = fallbackError.stderr?.trim() || fallbackError.message;
        throw new Error(`yt-dlp não conseguiu extrair o áudio: ${fallbackDetail}`);
      }
    } else {
      throw new Error(`yt-dlp não conseguiu extrair o áudio: ${detail}`);
    }
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
    ...(process.platform === 'win32' ? [
      process.env.APPDATA && path.join(process.env.APPDATA, 'Python', 'Python315', 'Scripts', 'yt-dlp.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'yt-dlp', 'yt-dlp.exe'),
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'yt-dlp', 'yt-dlp.exe')
    ] : [])
  ].filter(Boolean).filter((candidate, index, list) => list.indexOf(candidate) === index);

  for (const candidate of candidates.slice(0, 3)) {
    try {
      await execFileAsync(candidate, ['--version'], { windowsHide: true });
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
  if (duration !== undefined && (!Number.isFinite(requestedDuration) || requestedDuration <= 0)) {
    throw new Error('duration inválida');
  }

  removeExpiredResolvedEntries();
  const queryKey = normalizeTrackQuery(artist, title);
  const cached = resolvedStreamCache.get(queryKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let promise = inFlightPromises.get(queryKey);
  if (!promise) {
    promise = (async () => {
      const results = await yts.search(`${artist} ${title}`);
      const allCandidates = (results.videos || []).filter((video) => video.url);
      let candidates = allCandidates;
      if (requestedDuration > 0) {
        const durationMatchesCandidates = allCandidates.filter((video) =>
          durationMatches(video.seconds, requestedDuration)
        );
        if (durationMatchesCandidates.length > 0) candidates = durationMatchesCandidates;
      }
      candidates.sort((a, b) => Number(isTopicChannel(b.author?.name)) - Number(isTopicChannel(a.author?.name)));
      if (candidates.length === 0) throw new Error('Nenhum vídeo compatível encontrado');

      let resolved;
      let lastError;
      for (const candidate of candidates) {
        try {
          resolved = {
            ...await extractDirectAudioUrl(candidate.url),
            sourceUrl: candidate.url,
            title: candidate.title
          };
          break;
        } catch (error) {
          lastError = error;
          console.warn(`Falha ao extrair candidato "${candidate.title}": ${error.message}`);
          if (/Requested format is not available|no formats found/i.test(error.message)) break;
        }
      }
      if (!resolved) {
        throw new Error(`Falha ao extrair áudio de todos os candidatos: ${lastError?.message || 'sem detalhes'}`);
      }

      resolvedStreamCache.set(queryKey, {
        value: resolved,
        expiresAt: Date.now() + PREFETCH_CACHE_TTL_MS
      });
      return resolved;
    })().finally(() => inFlightPromises.delete(queryKey));
    inFlightPromises.set(queryKey, promise);
  }
  return promise;
}

export function getPrefetchStatus({ artist, title }) {
  const queryKey = normalizeTrackQuery(artist, title);
  removeExpiredResolvedEntries();
  if (resolvedStreamCache.has(queryKey)) return 'cached';
  if (inFlightPromises.has(queryKey)) return 'prefetching';
  return null;
}

export async function prefetchYouTubeStream({ artist, title }) {
  if (!artist || !title) throw new Error('artist e title são obrigatórios');
  const status = getPrefetchStatus({ artist, title });
  if (status === 'cached') return 'cached';
  await resolveYouTubeStream({ artist, title });
  return 'cached';
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
    invalidateResolvedStreamCache({ artist: query.artist, title: query.title });
    const refreshed = await extractDirectAudioUrl(resolved.sourceUrl);
    upstream = await fetch(refreshed.url, { headers });
  }
  if (!upstream.ok && upstream.status !== 206) {
    invalidateResolvedStreamCache({ artist: query.artist, title: query.title });
    directUrlCache.delete(cacheKey({
      artist: query.artist,
      title: query.title,
      duration: query.duration
    }));
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

export function invalidateResolvedStreamCache({ artist, title }) {
  resolvedStreamCache.delete(normalizeTrackQuery(artist, title));
}
