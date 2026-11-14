const artwork = (url, size) => url
  ? url.replace(/100x100bb/g, `${size}x${size}bb`)
  : `https://placehold.co/${size}x${size}/10131c/64748b?text=Glass+Music`;

export async function searchTracks(query, limit = 25) {
  const response = await fetch(`https://itunes.apple.com/search?media=music&entity=song&country=BR&limit=${limit}&term=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('Erro ao consultar catálogo iTunes');
  const data = await response.json();
  return (data.results || []).filter((item) => item.trackId && item.trackName && item.artistName).map((item) => ({
    trackId: item.trackId,
    title: item.trackName,
    artist: item.artistName,
    album: item.collectionName || 'Single',
    durationSec: Math.max(1, Math.round((item.trackTimeMillis || 30000) / 1000)),
    artworkMedium: artwork(item.artworkUrl100, 600),
    artworkLarge: artwork(item.artworkUrl100, 1000),
    previewUrl: item.previewUrl || ''
  }));
}
