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
