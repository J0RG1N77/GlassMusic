const artwork = (url, size) => url
  ? url.replace(/100x100bb/g, `${size}x${size}bb`)
  : `https://placehold.co/${size}x${size}/10131c/64748b?text=Glass+Music`;

export async function searchTracks(query, limit = 25) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];
  const proxySearch = await fetch(`/api/search?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`, {
    cache: 'no-store'
  }).catch(() => null);
  if (proxySearch?.ok) {
    const proxyData = await proxySearch.json();
    if (Array.isArray(proxyData.tracks) && proxyData.tracks.length > 0) return proxyData.tracks;
  }

  const encodedQuery = encodeURIComponent(cleanQuery);
  const responses = await Promise.allSettled([
    fetch(`https://itunes.apple.com/search?country=US&media=music&entity=song&limit=${limit}&explicit=Yes&term=${encodedQuery}`),
    fetch(`https://itunes.apple.com/search?country=BR&media=music&entity=song&limit=${limit}&explicit=Yes&term=${encodedQuery}`)
  ]);

  const tracks = [];
  const seen = new Set();
  for (const result of responses) {
    if (result.status !== 'fulfilled' || !result.value.ok) continue;
    const data = await result.value.json();
    for (const item of data.results || []) {
      if (!item.trackId || !item.trackName || !item.artistName) continue;
      const key = `${item.artistName}::${item.trackName}`
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      if (seen.has(key)) continue;
      seen.add(key);
      const durationSec = Math.max(1, Math.round((item.trackTimeMillis || 30000) / 1000));
      tracks.push({
        id: `itunes-${item.trackId}`,
        trackId: `itunes-${item.trackId}`,
        title: item.trackName,
        artist: item.artistName,
        album: item.collectionName || 'Single',
        durationSec,
        artworkMedium: artwork(item.artworkUrl100, 600),
        artworkLarge: artwork(item.artworkUrl100, 1000),
        previewUrl: item.previewUrl || '',
        explicit: Boolean(item.trackExplicitness === 'explicit' || item.contentAdvisoryRating === 'Explicit')
      });
      if (tracks.length >= limit) break;
    }
  }
  return tracks;
}
