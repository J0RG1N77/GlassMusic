import { escapeHtml, formatTime } from './dom.js';

export function renderTrackCard(track, index) {
  return `<article data-track-idx="${index}" class="glass-card rounded-3xl p-3">
    <img src="${escapeHtml(track.artworkMedium)}" alt="${escapeHtml(track.title)}" loading="lazy">
    <h3>${track.explicit ? '<span title="Conteúdo explícito">E</span> ' : ''}${escapeHtml(track.title)}</h3>
    <p>${escapeHtml(track.artist)}</p>
    <span>${formatTime(track.durationSec)}</span>
    <button data-action="play" data-idx="${index}" type="button">Tocar</button>
  </article>`;
}

export function renderPlaylistCard(playlist) {
  const covers = [...new Map(
    (playlist.tracks || [])
      .map((track) => track.artworkMedium || track.artworkLarge || '')
      .filter(Boolean)
      .map((cover) => [cover, cover])
  ).keys()].slice(0, 4);
  const mosaic = covers.length >= 4
    ? `<div class="grid grid-cols-2 gap-0.5 w-16 h-16 rounded-xl overflow-hidden border border-white/10 shrink-0">
        ${covers.map((cover) => `<img src="${escapeHtml(cover)}" alt="" class="w-full h-full object-cover" />`).join('')}
      </div>`
    : `<img src="${escapeHtml(covers[0] || 'https://placehold.co/200x200/10131c/64748b?text=Playlist')}" alt="" class="w-16 h-16 rounded-xl object-cover border border-white/10 shrink-0" />`;
  return `<div data-pl-id="${escapeHtml(playlist.id)}" class="glass-card rounded-2xl p-3 flex items-center gap-3 cursor-pointer">
    ${mosaic}
    <div class="min-w-0 flex-1">
      <h4 data-playlist-title="${escapeHtml(playlist.id)}" class="text-sm font-semibold text-white truncate">${escapeHtml(playlist.name)}</h4>
      <p class="text-xs text-white/50 mt-0.5">${playlist.tracks?.length || 0} ${(playlist.tracks?.length || 0) === 1 ? 'música' : 'músicas'}</p>
    </div>
    <button data-playlist-rename="${escapeHtml(playlist.id)}" class="p-2 rounded-xl text-white/45 hover:text-white hover:bg-white/10 shrink-0" title="Renomear playlist">
      <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
    </button>
  </div>`;
}
