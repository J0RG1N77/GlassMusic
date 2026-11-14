export function parseLrc(lrcText) {
  const lines = [];
  const pattern = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
  for (const rawLine of lrcText.split(/\r?\n/)) {
    const match = rawLine.match(pattern);
    if (!match) continue;
    const milliseconds = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
    const text = match[4].trim();
    if (text) lines.push({ time: Number(match[1]) * 60 + Number(match[2]) + milliseconds / 1000, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export async function fetchLyrics(track) {
  const exact = await fetch(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}&album_name=${encodeURIComponent(track.album)}&duration=${track.durationSec}`);
  const record = exact.ok ? await exact.json() : null;
  if (record?.syncedLyrics) return { type: 'synced', lines: parseLrc(record.syncedLyrics) };
  if (record?.plainLyrics) return { type: 'plain', lines: record.plainLyrics.split(/\r?\n/).map((text) => ({ time: null, text })) };
  return { type: 'none', lines: [] };
}
