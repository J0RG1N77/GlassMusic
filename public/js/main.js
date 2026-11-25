'use strict';
import { state as modularState } from './core/store.js';
import { AudioEngine as ModularAudioEngine } from './core/audioEngine.js';
import { applyTheme } from './core/themeEngine.js';
import { searchTracks as searchItunesTracks } from './services/itunesService.js';
import { fetchLyrics as fetchLrclibLyrics, parseLrc } from './services/lrclibService.js';
import { storageService } from './services/storageService.js';
import { escapeHtml, formatTime } from './ui/dom.js';
import { bindActionDelegation } from './ui/events.js';
import { renderPlaylistCard } from './ui/renderers.js';

      /* ======================================================================
         1. CONFIGURAÇÕES, CONSTANTES & ESTADO GLOBAL
         ====================================================================== */
      const STORAGE_KEYS = {
        SETTINGS: 'glass_music_settings_v1',
        FAVORITES: 'glass_music_favorites_v1',
        PLAYLISTS: 'glass_music_playlists_v1',
        HISTORY: 'glass_music_history_v1',
        QUEUE: 'glass_music_queue_v1',
        PRIORITY_QUEUE: 'glass_music_priority_queue_v1'
      };

      const DEFAULT_BACKEND_URL = typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? window.location.origin
        : 'http://localhost:3001';

      const DEFAULT_SETTINGS = {
        accentColor: '#38bdf8',
        glassAlpha: 0.44,
        glassBlur: 24,
        oledMode: false,
        accentMode: 'manual',
        atmosphereMode: 'soft',
        frequencyVisualizer: false,
        autoPlayEnabled: true,
        backendUrl: DEFAULT_BACKEND_URL
      };

      const ACCENT_PRESETS = [
        { name: 'Safira Glacial', hex: '#38bdf8' },
        { name: 'Ametista Neon', hex: '#a855f7' },
        { name: 'Esmeralda', hex: '#10b981' },
        { name: 'Quartzo Rosa', hex: '#f43f5e' },
        { name: 'Âmbar Solar', hex: '#f59e0b' },
        { name: 'Índigo Elétrico', hex: '#6366f1' }
      ];

      const DISCOVERY_CHIPS = [
        { label: 'Em Alta Brasil', query: 'Top Hits Brasil', category: 'em-alta-brasil' },
        { label: 'Pop Internacional', query: 'The Weeknd Dua Lipa', category: 'pop-internacional' },
        { label: 'Lo-Fi & Chill', query: 'Lofi Beats Chill', category: 'lofi-chill' },
        { label: 'Sertanejo', query: 'Sertanejo', category: 'sertanejo' },
        { label: 'Eletrônica', query: 'Daft Punk Fred Again', category: 'eletronica' },
        { label: 'Rock Clássico', query: 'Coldplay Arctic Monkeys', category: 'rock-classico' },
        { label: 'R&B / Soul', query: 'Frank Ocean SZA', category: 'rb-soul' }
      ];

      const state = {
        settings: { ...DEFAULT_SETTINGS },
        favorites: [],
        playlists: [],
        history: [],
        currentView: 'explore',      // 'explore' | 'favorites' | 'history' | 'playlists' | 'playlist-detail'
        activePlaylistId: null,
        activeChipQuery: DISCOVERY_CHIPS[0].query,
        activeDiscoveryCategory: DISCOVERY_CHIPS[0].category,
        displayedTracks: [],
        queue: [],
        priorityQueue: [],
        queueIndex: -1,
        currentTrack: null,
        isQueueOpen: false,
        queueTab: 'queue',
        autoPlayEnabled: true,
        prefetchedRadioTrack: null,
        isPlaying: false,
        shuffle: false,
        repeatMode: 'off',           // 'off' | 'all' | 'one'
        backendOnline: null,         // null | true | false
        activeStreamSource: 'standby', // 'standby' | 'proxy' | 'preview'
        lyricsCache: new Map(),
        currentLyrics: null,         // { type: 'synced'|'plain'|'none', lines: [] }
        activeLyricIndex: -1,
        desktopLyricsOpen: false,
        fullscreenOpen: false,
        fullscreenTab: 'cover',      // 'cover' | 'lyrics'
        pendingTrackForPlaylist: null,
        activeAmbientSlot: 'a',
        isMiniPlayer: false,
        audioContext: null,
        audioAnalyser: null,
        audioSource: null,
        audioAnimationFrame: null
      };

      /* ======================================================================
         2. GERENCIAMENTO DE ARMAZENAMENTO LOCAL (SEM LINKS EXPIRÁVEIS)
         ====================================================================== */
      const Storage = {
        load() {
          try {
            const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || 'null');
            if (savedSettings) {
              state.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
              state.autoPlayEnabled = state.settings.autoPlayEnabled !== false;
              if (window.location.protocol === 'https:' && /^https?:\/\/localhost(?::\d+)?$/i.test(state.settings.backendUrl)) {
                state.settings.backendUrl = DEFAULT_BACKEND_URL;
                this.saveSettings();
              }
            }
            state.favorites = JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES) || '[]');
            state.playlists = JSON.parse(localStorage.getItem(STORAGE_KEYS.PLAYLISTS) || '[]');
            state.history = JSON.parse(localStorage.getItem(STORAGE_KEYS.HISTORY) || '[]');
            state.queue = JSON.parse(localStorage.getItem(STORAGE_KEYS.QUEUE) || '[]');
            state.priorityQueue = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRIORITY_QUEUE) || '[]');
          } catch (err) {
            console.warn('Falha ao carregar dados locais:', err);
          }
        },

        saveSettings() {
          try {
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
          } catch (e) {}
        },

        saveFavorites() {
          try {
            localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(state.favorites));
          } catch (e) {}
        },

        savePlaylists() {
          try {
            localStorage.setItem(STORAGE_KEYS.PLAYLISTS, JSON.stringify(state.playlists));
          } catch (e) {}
        },

        saveHistory() {
          try {
            localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(state.history.slice(0, 60)));
          } catch (e) {}
        },

        saveQueue() {
          try {
            localStorage.setItem(STORAGE_KEYS.QUEUE, JSON.stringify(state.queue));
            localStorage.setItem(STORAGE_KEYS.PRIORITY_QUEUE, JSON.stringify(state.priorityQueue));
          } catch (e) {}
        },

        renamePlaylist(playlistId, newName) {
          const playlist = storageService.renamePlaylist(playlistId, newName);
          if (!playlist) return false;
          const localPlaylist = state.playlists.find((item) => item.id === playlistId);
          if (localPlaylist) localPlaylist.name = playlist.name;
          this.savePlaylists();
          return true;
        },

        removeTrackFromPlaylist(playlistId, trackIndex) {
          const removed = storageService.removeTrackFromPlaylist(playlistId, trackIndex);
          if (!removed) return false;
          const localPlaylist = state.playlists.find((item) => item.id === playlistId);
          if (localPlaylist?.tracks) localPlaylist.tracks.splice(trackIndex, 1);
          this.savePlaylists();
          return true;
        },

        moveTrackInPlaylist(playlistId, fromIndex, toIndex) {
          if (!storageService.moveTrackInPlaylist(playlistId, fromIndex, toIndex)) return false;
          const localPlaylist = state.playlists.find((item) => item.id === playlistId);
          if (localPlaylist?.tracks) {
            const [track] = localPlaylist.tracks.splice(fromIndex, 1);
            localPlaylist.tracks.splice(toIndex, 0, track);
          }
          this.savePlaylists();
          return true;
        },

        exportPlaylistCSV(playlistId) {
          return storageService.exportPlaylistCSV(playlistId);
        },

        // Sanitiza metadados da faixa antes de salvar (nunca persiste URLs de stream temporárias)
        sanitizeTrackMetadata(track) {
          return {
            trackId: track.trackId,
            title: track.title,
            artist: track.artist,
            album: track.album,
            durationSec: track.durationSec,
            artworkMedium: track.artworkMedium,
            artworkLarge: track.artworkLarge,
            previewUrl: track.previewUrl || ''
          };
        }
      };

      /* ======================================================================
         3. MOTOR VISUAL & GLASSMORPHISM EM TEMPO REAL
         ====================================================================== */
      const ThemeEngine = {
        hexToRgb(hex) {
          const clean = hex.replace('#', '');
          const bigint = parseInt(clean.length === 3
            ? clean.split('').map(c => c + c).join('')
            : clean, 16);
          const r = (bigint >> 16) & 255;
          const g = (bigint >> 8) & 255;
          const b = bigint & 255;
          return `${r}, ${g}, ${b}`;
        },

        applyAll() {
          const root = document.documentElement;
          const { accentColor, glassAlpha, glassBlur, oledMode, accentMode, atmosphereMode, frequencyVisualizer } = state.settings;

          root.style.setProperty('--accent-color', accentColor);
          root.style.setProperty('--accent-rgb', this.hexToRgb(accentColor));
          root.style.setProperty('--glass-alpha', glassAlpha.toFixed(2));
          root.style.setProperty('--glass-blur', `${glassBlur}px`);
          root.style.setProperty('--bg-base', oledMode ? '#000000' : '#06070a');

          const backdrop = document.getElementById('ambient-backdrop');
          if (oledMode) {
            backdrop.classList.add('oled-hidden');
          } else {
            backdrop.classList.remove('oled-hidden');
          }
          backdrop.classList.toggle('atmosphere-immersive', !oledMode && atmosphereMode === 'immersive');
          backdrop.classList.toggle('atmosphere-aurora', !oledMode && atmosphereMode === 'aurora');

          // Atualiza visual dos controles do painel de personalização
          const alphaPct = Math.round(glassAlpha * 100);
          const sliderAlpha = document.getElementById('slider-glass-alpha');
          const sliderBlur = document.getElementById('slider-glass-blur');
          if (sliderAlpha) {
            sliderAlpha.value = alphaPct;
            this.updateSliderFill(sliderAlpha);
          }
          if (sliderBlur) {
            sliderBlur.value = glassBlur;
            this.updateSliderFill(sliderBlur);
          }

          document.getElementById('val-glass-alpha').textContent = `${alphaPct}%`;
          document.getElementById('val-glass-blur').textContent = `${glassBlur}px`;
          document.getElementById('customizer-accent-hex').textContent = accentColor.toUpperCase();
          document.getElementById('input-accent-picker').value = accentColor;

          // Switch OLED
          const toggleBtn = document.getElementById('toggle-oled-mode');
          const toggleKnob = document.getElementById('toggle-oled-knob');
          toggleBtn.setAttribute('aria-checked', String(oledMode));
          if (oledMode) {
            toggleBtn.style.backgroundColor = accentColor;
            toggleKnob.style.transform = 'translateX(20px)';
          } else {
            toggleBtn.style.backgroundColor = 'rgba(255,255,255,0.16)';
            toggleKnob.style.transform = 'translateX(0px)';
          }

          document.querySelectorAll('[data-atmosphere]').forEach(button => {
            const active = button.dataset.atmosphere === atmosphereMode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
            button.disabled = oledMode;
          });
          document.getElementById('atmosphere-options')?.toggleAttribute('disabled', oledMode);
          document.getElementById('atmosphere-options')?.classList.toggle('opacity-40', oledMode);
          document.getElementById('atmosphere-status').textContent = oledMode
            ? 'Ativa apenas com o modo OLED desligado'
            : 'Ativa enquanto o modo OLED estiver desligado';

          const autoBtn = document.getElementById('btn-accent-auto');
          if (autoBtn) {
            autoBtn.classList.toggle('active', accentMode === 'auto');
            autoBtn.setAttribute('aria-pressed', String(accentMode === 'auto'));
          }

          const visualizerBtn = document.getElementById('toggle-frequency-visualizer');
          const visualizerKnob = document.getElementById('toggle-frequency-knob');
          if (visualizerBtn) {
            visualizerBtn.setAttribute('aria-checked', String(frequencyVisualizer));
            visualizerBtn.style.backgroundColor = frequencyVisualizer ? accentColor : 'rgba(255,255,255,0.16)';
            visualizerKnob.style.transform = frequencyVisualizer ? 'translateX(20px)' : 'translateX(0px)';
          }

          // Atualiza preenchimento dos sliders de progresso e volume
          this.updateSliderFill(document.getElementById('desktop-progress'));
          this.updateSliderFill(document.getElementById('desktop-volume'));
          this.updateSliderFill(document.getElementById('fs-progress'));
        },

        updateSliderFill(inputEl) {
          if (!inputEl) return;
          const min = parseFloat(inputEl.min || 0);
          const max = parseFloat(inputEl.max || 100);
          const val = parseFloat(inputEl.value || 0);
          const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
          inputEl.style.setProperty('--slider-pct', `${pct}%`);
        },

        // Crossfade suave da capa 1000x1000 desfocada no plano de fundo
        setAmbientArtwork(url) {
          if (!url) return;
          if (state.settings.accentMode === 'auto') {
            this.extractDominantAccent(url);
          }
          const imgA = document.getElementById('ambient-img-a');
          const imgB = document.getElementById('ambient-img-b');

          if (state.activeAmbientSlot === 'a') {
            imgB.src = url;
            imgB.onload = () => {
              imgB.classList.remove('opacity-0');
              imgB.classList.add('opacity-85');
              imgA.classList.remove('opacity-85', 'opacity-80');
              imgA.classList.add('opacity-0');
              state.activeAmbientSlot = 'b';
            };
          } else {
            imgA.src = url;
            imgA.onload = () => {
              imgA.classList.remove('opacity-0');
              imgA.classList.add('opacity-85');
              imgB.classList.remove('opacity-85', 'opacity-80');
              imgB.classList.add('opacity-0');
              state.activeAmbientSlot = 'a';
            };
          }
        },

        async extractDominantAccent(url) {
          try {
            if (!url) throw new Error('Capa indisponível');
            let imageUrl = url;
            if (/^https?:\/\//i.test(url)) {
              const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
              imageUrl = `${baseUrl}/api/image-proxy?url=${encodeURIComponent(url)}`;
            }
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.src = imageUrl;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, 64, 64);
            const pixels = context.getImageData(0, 0, 64, 64).data;
            const colors = new Map();
            for (let i = 0; i < pixels.length; i += 16) {
              const r = pixels[i];
              const g = pixels[i + 1];
              const b = pixels[i + 2];
              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const saturation = max === 0 ? 0 : (max - min) / max;
              const brightness = (r + g + b) / 765;
              if (max < 35 || brightness > 0.92 || saturation < 0.18) continue;
              const key = `${r >> 4},${g >> 4},${b >> 4}`;
              const score = saturation * 3 + (1 - Math.abs(brightness - 0.48));
              const entry = colors.get(key) || { r: 0, g: 0, b: 0, count: 0, score: 0 };
              entry.r += r;
              entry.g += g;
              entry.b += b;
              entry.count += 1;
              entry.score += score;
              colors.set(key, entry);
            }
            let best = null;
            colors.forEach((entry) => {
              if (!best || entry.score > best.score) best = entry;
            });
            if (!best) return;
            if (!best.count) return;
            const rq = best.r / best.count;
            const gq = best.g / best.count;
            const bq = best.b / best.count;
            const hex = `#${Math.max(0, Math.min(255, Math.round(rq))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(gq))).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, Math.round(bq))).toString(16).padStart(2, '0')}`;
            if (state.settings.accentMode === 'auto') {
              state.settings.accentColor = hex;
              Storage.saveSettings();
              this.applyAll();
            }
          } catch (error) {
            console.warn('Não foi possível extrair a cor da capa:', error.message);
            if (state.settings.accentMode === 'auto') {
              state.settings.accentColor = DEFAULT_SETTINGS.accentColor;
              Storage.saveSettings();
              this.applyAll();
            }
          }
        },

        initAudioVisualizer() {
          if (!state.settings.frequencyVisualizer) {
            const canvas = document.getElementById('audio-spectrum');
            if (canvas) canvas.classList.add('opacity-0');
            if (state.audioAnimationFrame) cancelAnimationFrame(state.audioAnimationFrame);
            return;
          }
          if (!state.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            state.audioContext = new AudioContext();
            state.audioAnalyser = state.audioContext.createAnalyser();
            state.audioAnalyser.fftSize = 64;
            state.audioAnalyser.smoothingTimeConstant = 0.82;
            state.audioSource = state.audioContext.createMediaElementSource(audio);
            state.audioSource.connect(state.audioAnalyser);
            state.audioAnalyser.connect(state.audioContext.destination);
          }
          if (state.audioContext.state === 'suspended') state.audioContext.resume();
          const canvas = document.getElementById('audio-spectrum');
          if (canvas) canvas.classList.remove('opacity-0');
          this.drawAudioVisualizer();
        },

        drawAudioVisualizer() {
          if (!state.settings.frequencyVisualizer || !state.audioAnalyser) return;
          const canvas = document.getElementById('audio-spectrum');
          if (!canvas) return;
          const rect = canvas.getBoundingClientRect();
          const ratio = window.devicePixelRatio || 1;
          if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) {
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
          }
          const context = canvas.getContext('2d');
          context.clearRect(0, 0, canvas.width, canvas.height);
          const data = new Uint8Array(state.audioAnalyser.frequencyBinCount);
          state.audioAnalyser.getByteFrequencyData(data);
          const barCount = 38;
          const gap = 2 * ratio;
          const barWidth = Math.max(1, (canvas.width - gap * (barCount - 1)) / barCount);
          context.fillStyle = state.settings.accentColor;
          for (let i = 0; i < barCount; i++) {
            const value = data[Math.floor(i * data.length / barCount)] / 255;
            const height = Math.max(2 * ratio, value * canvas.height * 0.85);
            const x = i * (barWidth + gap);
            context.globalAlpha = 0.28 + value * 0.42;
            context.fillRect(x, canvas.height - height, barWidth, height);
          }
          state.audioAnimationFrame = requestAnimationFrame(() => this.drawAudioVisualizer());
        }
      };

      /* ======================================================================
         4. SERVIÇOS DE API: ITUNES SEARCH, LRCLIB & PROXY NODE.JS
         ====================================================================== */
      const ApiService = {
        async prefetchTrack(track) {
          if (!track?.title || !track?.artist) return;
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          await fetch(`${baseUrl}/api/prefetch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: track.title, artist: track.artist }),
            cache: 'no-store'
          }).catch(() => {});
        },

        async importSpotifyPlaylist(url) {
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          const response = await fetch(`${baseUrl}/api/import-playlist`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.message || data.error || 'Não foi possível importar a playlist');
          return data;
        },

        async fetchAutoplay(artist, title, exclude = []) {
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          const params = new URLSearchParams({
            artist,
            title,
            exclude: Array.isArray(exclude) ? exclude.join(',') : ''
          });
          const response = await fetch(`${baseUrl}/api/autoplay?${params.toString()}`, {
            cache: 'no-store'
          });
          if (!response.ok) throw new Error('Não foi possível carregar a Rádio da Faixa');
          const data = await response.json();
          return Array.isArray(data.tracks) ? data.tracks : [];
        },

        async discoverTracks(category) {
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          try {
            const response = await fetch(`${baseUrl}/api/discover?category=${encodeURIComponent(category)}`, {
              cache: 'no-store'
            });
            if (!response.ok) throw new Error('Erro ao consultar catálogo dinâmico');
            const data = await response.json();
            if (Array.isArray(data.tracks) && data.tracks.length > 0) return data.tracks;
          } catch (error) {
            console.warn('Catálogo dinâmico indisponível:', error.message);
          }
          const fallbackQueries = {
            'em-alta-brasil': 'Top Hits Brasil',
            'pop-internacional': 'The Weeknd Dua Lipa',
            'lofi-chill': 'Lofi Beats Chill',
            'sertanejo': 'Sertanejo',
            'eletronica': 'Daft Punk Fred Again',
            'rock-classico': 'Coldplay Arctic Monkeys',
            'rb-soul': 'Frank Ocean SZA'
          };
          return this.searchTracks(fallbackQueries[category] || 'Top Hits', 25);
        },

        // Busca metadados oficiais no iTunes Search API (sem necessidade de chave)
        async searchTracks(query, limit = 25) {
          const cleanQuery = String(query || '').trim();
          if (!cleanQuery) return [];
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          try {
            const response = await fetch(
              `${baseUrl}/api/search?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`,
              { cache: 'no-store' }
            );
            if (response.ok) {
              const data = await response.json();
              if (Array.isArray(data.tracks) && data.tracks.length > 0) return data.tracks;
            }
          } catch (error) {
            console.warn('Busca combinada indisponível:', error.message);
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
              const baseArt = item.artworkUrl100 || '';
              tracks.push({
                id: `itunes-${item.trackId}`,
                trackId: `itunes-${item.trackId}`,
                title: item.trackName,
                artist: item.artistName,
                album: item.collectionName || 'Single',
                durationSec: Math.max(1, Math.round((item.trackTimeMillis || 30000) / 1000)),
                artworkMedium: baseArt ? baseArt.replace('100x100bb', '600x600bb') : 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music',
                artworkLarge: baseArt ? baseArt.replace('100x100bb', '1000x1000bb') : 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
                previewUrl: item.previewUrl || '',
                explicit: Boolean(item.trackExplicitness === 'explicit' || item.contentAdvisoryRating === 'Explicit')
              });
              if (tracks.length >= limit) break;
            }
            if (tracks.length >= limit) break;
          }
          return tracks;
        },

        // Consulta LRCLIB para obter letras sincronizadas (LRC) ou estáticas
        async fetchLyrics(track) {
          const cacheKey = `${track.trackId}`;
          if (state.lyricsCache.has(cacheKey)) {
            return state.lyricsCache.get(cacheKey);
          }

          try {
            // Tentativa 1: Correspondência exata via /api/get
            const exactUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}&album_name=${encodeURIComponent(track.album)}&duration=${track.durationSec}`;
            let res = await fetch(exactUrl);
            let record = res.ok ? await res.json() : null;

            // Tentativa 2: Busca flexível via /api/search se não houver syncedLyrics
            if (!record || (!record.syncedLyrics && !record.plainLyrics)) {
              const searchUrl = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(track.artist)}&track_name=${encodeURIComponent(track.title)}`;
              const searchRes = await fetch(searchUrl);
              if (searchRes.ok) {
                const list = await searchRes.json();
                if (Array.isArray(list) && list.length > 0) {
                  // Prioriza faixa com letra sincronizada e duração mais próxima
                  record = list.sort((a, b) => {
                    const aSync = a.syncedLyrics ? 0 : 1;
                    const bSync = b.syncedLyrics ? 0 : 1;
                    if (aSync !== bSync) return aSync - bSync;
                    return Math.abs((a.duration || track.durationSec) - track.durationSec) -
                           Math.abs((b.duration || track.durationSec) - track.durationSec);
                  })[0];
                }
              }
            }

            let parsed = { type: 'none', lines: [] };
            if (record?.syncedLyrics) {
              parsed = {
                type: 'synced',
                lines: this.parseLrc(record.syncedLyrics)
              };
            } else if (record?.plainLyrics) {
              parsed = {
                type: 'plain',
                lines: record.plainLyrics.split('\n').map(text => ({ time: null, text: text.trim() }))
              };
            }

            state.lyricsCache.set(cacheKey, parsed);
            return parsed;
          } catch (err) {
            console.warn('Erro ao buscar letra no LRCLIB:', err);
            return { type: 'none', lines: [] };
          }
        },

        // Converte strings LRC "[mm:ss.xx] Texto" em objetos ordenados por segundo
        parseLrc(lrcText) {
          const lines = [];
          const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
          for (const rawLine of lrcText.split('\n')) {
            const match = rawLine.match(regex);
            if (match) {
              const minutes = parseInt(match[1], 10);
              const seconds = parseInt(match[2], 10);
              const msPart = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
              const time = minutes * 60 + seconds + msPart / 1000;
              const text = match[4].trim();
              if (text) {
                lines.push({ time, text });
              }
            }
          }
          return lines.sort((a, b) => a.time - b.time);
        },

        // Verifica se o servidor Node.js proxy local está respondendo
        async checkBackendHealth(customUrl, timeoutMs = 4000) {
          const baseUrl = (customUrl || state.settings.backendUrl).replace(/\/$/, '');
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);

          try {
            const res = await fetch(`${baseUrl}/api/health`, {
              signal: controller.signal,
              cache: 'no-store'
            });
            state.backendOnline = res.ok;
          } catch (err) {
            state.backendOnline = false;
          } finally {
            clearTimeout(timeout);
          }

          UI.updateBackendStatusUI();
          return state.backendOnline;
        }
      };

      /* ======================================================================
         5. MOTOR DE ÁUDIO NATIVO, FALLBACK INTELIGENTE & MEDIA SESSION API
         ====================================================================== */
      const audio = document.getElementById('native-audio');

      const AudioEngine = {
        mediaControlActionsRef: { current: {} },

        updateMediaControlActions() {
          this.mediaControlActionsRef.current = {
            prev: () => this.prevTrack(),
            'toggle-play': () => this.togglePlayPause(),
            next: () => this.nextTrack()
          };
        },

        init() {
          audio.volume = 0.85;
          ThemeEngine.initAudioVisualizer();
          this.updateMediaControlActions();

          audio.addEventListener('play', () => {
            state.isPlaying = true;
            window.glassMusicControls?.sendPlaybackState(true);
            UI.updatePlayStateUI();
            this.updateMediaSessionPlaybackState();
          });

          audio.addEventListener('pause', () => {
            state.isPlaying = false;
            window.glassMusicControls?.sendPlaybackState(false);
            UI.updatePlayStateUI();
            this.updateMediaSessionPlaybackState();
          });

          audio.addEventListener('timeupdate', () => {
            this.handleProgressUpdate();
            this.prefetchNextTrack();
          });

          audio.addEventListener('loadedmetadata', () => {
            this.handleProgressUpdate();
            this.updateMediaSessionPosition();
          });

          audio.addEventListener('ended', () => {
            if (state.repeatMode === 'one') {
              audio.currentTime = 0;
              audio.play().catch(() => {});
            } else {
              this.handleNextTrack(true);
            }
          });

          const mediaControls = window.glassMusicControls
            || window.electronUpdater
            || window.glassMusicUpdater;
          mediaControls?.onMediaControl?.((action) => {
            this.mediaControlActionsRef.current[action]?.();
          });

          this.setupMediaSessionHandlers();
        },

        // Reproduz uma faixa sob demanda (Proxy Node.js -> Fallback automático iTunes Preview)
        async playTrack(track, queueList = null) {
          if (!track) return;

          if (Array.isArray(queueList) && queueList.length > 0) {
            state.queue = [...queueList].filter((t, index, list) => (
              t.trackId !== track.trackId
              && list.findIndex(item => item.trackId === t.trackId) === index
            ));
          }
          if (state.currentTrack && state.currentTrack.trackId !== track.trackId) {
            const previous = Storage.sanitizeTrackMetadata(state.currentTrack);
            state.history = [previous, ...state.history.filter(t => t.trackId !== previous.trackId)].slice(0, 60);
            Storage.saveHistory();
          }
          state.queueIndex = state.queue.findIndex(t => t.trackId === track.trackId);

          state.currentTrack = track;
          state.prefetchedRadioTrack = null;
          this.prefetchedTrackId = null;
          state.activeLyricIndex = -1;

          // Atualiza interface visual & iluminação ambiente imediatamente
          UI.renderNowPlaying(track);
          ThemeEngine.setAmbientArtwork(track.artworkLarge);
          this.updateMediaSessionMetadata(track);

          // Carrega letras sincronizadas em paralelo
          LyricsController.loadForTrack(track);

          // Constrói URL do Proxy Node.js
          const baseUrl = state.settings.backendUrl.replace(/\/$/, '');
          const proxyStreamUrl = `${baseUrl}/api/stream?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&duration=${track.durationSec}`;

          // Tenta reproduzir via Proxy Node.js com fallback automático caso falhe
          let fallbackTriggered = false;
          const fallbackToPreview = async () => {
            if (fallbackTriggered) return;
            fallbackTriggered = true;
            audio.removeEventListener('error', onProxyError);
            if (state.currentTrack?.trackId !== track.trackId) return;

            // Uma falha de stream não prova que o proxy está offline.
            const proxyIsHealthy = await ApiService.checkBackendHealth(baseUrl, 4000);
            if (state.currentTrack?.trackId !== track.trackId) return;
            if (proxyIsHealthy) {
              UI.showToast('O servidor está ativo, mas não conseguiu resolver esta faixa. Verifique o yt-dlp no servidor.', 'error');
              return;
            }

            if (track.previewUrl) {
              this.startStream(track.previewUrl, 'preview');
            } else {
              UI.showToast('Faixa indisponível sem o servidor Node.js ativo.', 'error');
            }
          };

          const onProxyError = () => {
            if (!audio.paused || audio.error) fallbackToPreview();
          };
          audio.addEventListener('error', onProxyError, { once: true });

          this.startStream(proxyStreamUrl, 'proxy');
        },

        playNow(track, contextList = []) {
          if (!track) return;
          const trackId = track.trackId || track.id || track.videoId;
          if (!trackId) return;

          state.priorityQueue = state.priorityQueue.filter(t => (t.trackId || t.id || t.videoId) !== trackId);
          state.queue = state.queue.filter(t => (t.trackId || t.id || t.videoId) !== trackId);
          Storage.saveQueue();

          const context = Array.isArray(contextList)
            ? contextList.filter((t, index, list) => {
              const id = t.trackId || t.id || t.videoId;
              return id && id !== trackId
                && list.findIndex(item => (item.trackId || item.id || item.videoId) === id) === index;
            })
            : [];
          void this.playTrack(track, context.length > 0 ? context : null);
        },

        playNext(track) {
          if (!track) return;
          const clean = Storage.sanitizeTrackMetadata(track);
          state.priorityQueue = [
            clean,
            ...state.priorityQueue.filter(t => t.trackId !== clean.trackId)
          ];
          state.queue = state.queue.filter(t => t.trackId !== clean.trackId);
          Storage.saveQueue();
          UI.renderQueueDrawer();
          UI.showToast('Tocar a seguir', 'success');
        },

        addToQueue(track) {
          if (!track) return;
          const clean = Storage.sanitizeTrackMetadata(track);
          if (clean.trackId === state.currentTrack?.trackId) return;
          state.queue = [...state.queue.filter(t => t.trackId !== clean.trackId), clean];
          state.priorityQueue = state.priorityQueue.filter(t => t.trackId !== clean.trackId);
          Storage.saveQueue();
          UI.renderQueueDrawer();
          UI.showToast('Adicionada à fila', 'success');
        },

        async prefetchNextTrack() {
          if (!state.currentTrack || !audio.duration || isNaN(audio.duration)) return;
          if (audio.duration <= 30 || (audio.duration - audio.currentTime) > 25) return;

          const trackId = state.currentTrack.trackId
            || state.currentTrack.id
            || state.currentTrack.videoId;
          if (!trackId || this.prefetchedTrackId === trackId) return;
          this.prefetchedTrackId = trackId;

          let nextTrack = state.priorityQueue[0] || state.queue[0] || null;
          if (!nextTrack) {
            if (!state.autoPlayEnabled || state.repeatMode === 'all' || state.repeatMode === 'one') return;
            if (this.autoplayPrefetchLoading) return;
            this.autoplayPrefetchLoading = true;
            try {
              const exclude = [
                state.currentTrack.title,
                state.currentTrack.trackId,
                state.currentTrack.artist,
                ...state.history.map((item) => item.title)
              ].filter(Boolean);
              const recommendations = await ApiService.fetchAutoplay(
                state.currentTrack.artist,
                state.currentTrack.title,
                exclude
              );
              nextTrack = recommendations[0] || null;
              if (!nextTrack) return;
              nextTrack = Storage.sanitizeTrackMetadata({
                ...nextTrack,
                trackId: nextTrack.trackId || `radio-${nextTrack.artist}-${nextTrack.title}`,
                artworkMedium: nextTrack.artworkMedium || nextTrack.cover,
                artworkLarge: nextTrack.artworkLarge || nextTrack.cover
              });
              state.prefetchedRadioTrack = nextTrack;
            } catch (error) {
              console.warn('Falha ao pré-carregar recomendação:', error.message);
              return;
            } finally {
              this.autoplayPrefetchLoading = false;
            }
          }

          await ApiService.prefetchTrack(nextTrack);
        },

        async ensureAutoplayQueue(track, playFirst = false) {
          if (!state.autoPlayEnabled || state.repeatMode === 'all' || state.repeatMode === 'one') return;
          if (!track?.artist || !track?.title) return;
          if (state.priorityQueue.length > 0 || state.queue.length > 0) return;
          if (this.autoplayLoading) return;

          this.autoplayLoading = true;
          try {
            if (state.prefetchedRadioTrack) {
              const cleanTrack = state.prefetchedRadioTrack;
              state.prefetchedRadioTrack = null;
              if (playFirst) this.playNow(cleanTrack);
              return;
            }
            const exclude = [
              track.title,
              track.trackId,
              track.artist,
              ...state.history.map((item) => item.title)
            ].filter(Boolean);
            const recommendations = await ApiService.fetchAutoplay(track.artist, track.title, exclude);
            if (!state.autoPlayEnabled) return;
            const firstTrack = recommendations[0];
            if (!firstTrack) return;
            const cleanTrack = Storage.sanitizeTrackMetadata({
              ...firstTrack,
              trackId: firstTrack.trackId || `radio-${firstTrack.artist}-${firstTrack.title}`,
              artworkMedium: firstTrack.artworkMedium || firstTrack.cover,
              artworkLarge: firstTrack.artworkLarge || firstTrack.cover
            });
            UI.showToast('Próxima da Rádio da Faixa', 'success');
            if (playFirst) this.playNow(cleanTrack);
          } catch (error) {
            console.warn('Falha ao carregar Rádio da Faixa:', error.message);
          } finally {
            this.autoplayLoading = false;
          }
        },

        handleNextTrack(autoAdvance = false) {
          let nextTrack = null;
          if (state.priorityQueue.length > 0) {
            nextTrack = state.priorityQueue.shift();
          } else if (state.queue.length > 0) {
            nextTrack = state.queue.shift();
          }

          if (nextTrack) {
            Storage.saveQueue();
            this.playTrack(nextTrack);
            return;
          }

          if (state.autoPlayEnabled && state.repeatMode !== 'all' && state.repeatMode !== 'one') {
            if (this.autoplayLoading) {
              setTimeout(() => this.handleNextTrack(true), 300);
              return;
            }
            void this.ensureAutoplayQueue(state.currentTrack, true);
            return;
          }

          if (state.repeatMode === 'all' || (!autoAdvance && state.queue.length === 0)) {
            if (state.queueIndex >= 0 && state.displayedTracks?.length > 0) {
              this.playTrack(state.displayedTracks[0], state.displayedTracks);
            }
          }
        },

        handlePreviousTrack() {
          if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
          }
          const previous = state.history.find(track => track.trackId !== state.currentTrack?.trackId);
          if (!previous) return;
          state.history = state.history.filter(track => track.trackId !== previous.trackId);
          Storage.saveHistory();
          this.playTrack(previous);
        },

        removeFromQueue(id, listType = 'queue', index = -1) {
          const targetList = listType === 'priority' ? state.priorityQueue : state.queue;
          if (index >= 0 && index < targetList.length) {
            targetList.splice(index, 1);
            Storage.saveQueue();
            UI.renderQueueDrawer();
            return;
          }
          if (listType === 'priority') {
            state.priorityQueue = state.priorityQueue.filter(track =>
              (track.trackId || track.id || track.videoId) !== id
            );
          } else {
            state.queue = state.queue.filter(track =>
              (track.trackId || track.id || track.videoId) !== id
            );
          }
          Storage.saveQueue();
          UI.renderQueueDrawer();
        },

        reorderQueue(fromIndex, toIndex) {
          if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.queue.length || toIndex >= state.queue.length) return;
          const reordered = [...state.queue];
          const [track] = reordered.splice(fromIndex, 1);
          reordered.splice(toIndex, 0, track);
          state.queue = reordered;
          Storage.saveQueue();
          UI.renderQueueDrawer();
        },

        clearQueue() {
          state.priorityQueue = [];
          state.queue = [];
          Storage.saveQueue();
          UI.renderQueueDrawer();
          UI.showToast('Fila limpa');
        },

        startStream(url, sourceType) {
          state.activeStreamSource = sourceType;
          UI.updateTechnicalBadge();
          audio.src = url;
          audio.load();
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                // O estado ONLINE/OFFLINE é alterado exclusivamente por checkBackendHealth.
              })
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.warn('Aviso ao iniciar áudio:', err.message);
                }
              });
          }
        },

        togglePlayPause() {
          if (!state.currentTrack) {
            if (state.displayedTracks.length > 0) {
              this.playTrack(state.displayedTracks[0], state.displayedTracks);
            }
            return;
          }
          if (audio.paused) {
            audio.play().catch(() => {});
          } else {
            audio.pause();
          }
        },

        nextTrack(autoAdvance = false) {
          this.handleNextTrack(autoAdvance);
        },

        prevTrack() {
          this.handlePreviousTrack();
        },

        seekToPercent(pct) {
          if (!audio.duration || isNaN(audio.duration)) return;
          audio.currentTime = (pct / 100) * audio.duration;
          this.updateMediaSessionPosition();
        },

        seekToSeconds(sec) {
          if (!audio.duration || isNaN(audio.duration)) return;
          audio.currentTime = Math.min(audio.duration, Math.max(0, sec));
          this.updateMediaSessionPosition();
        },

        handleProgressUpdate() {
          const current = audio.currentTime || 0;
          const total = (audio.duration && !isNaN(audio.duration))
            ? audio.duration
            : (state.currentTrack?.durationSec || 0);
          const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;

          const formattedCur = UI.formatTime(current);
          const formattedTot = UI.formatTime(total);

          // Desktop progress
          const dProg = document.getElementById('desktop-progress');
          dProg.value = pct;
          ThemeEngine.updateSliderFill(dProg);
          document.getElementById('desktop-time-current').textContent = formattedCur;
          document.getElementById('desktop-time-total').textContent = formattedTot;

          // Mobile mini-player thin bar
          document.getElementById('mobile-mini-progress-bar').style.width = `${pct}%`;

          // Fullscreen progress
          const fsProg = document.getElementById('fs-progress');
          fsProg.value = pct;
          ThemeEngine.updateSliderFill(fsProg);
          document.getElementById('fs-time-current').textContent = formattedCur;
          document.getElementById('fs-time-total').textContent = formattedTot;

          // Sincroniza letra karaoke
          LyricsController.syncTime(current);

          const miniProgress = document.getElementById('mini-player-progress');
          if (miniProgress) miniProgress.value = String(pct);
        },

        recordHistory(track) {
          const clean = Storage.sanitizeTrackMetadata(track);
          state.history = [clean, ...state.history.filter(t => t.trackId !== clean.trackId)].slice(0, 60);
          Storage.saveHistory();
          if (state.currentView === 'history') {
            UI.renderCurrentView();
          }
        },

        // Integração nativa com a tela de bloqueio do Android e iOS (Media Session API)
        updateMediaSessionMetadata(track) {
          if (!('mediaSession' in navigator)) return;
          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: track.title,
              artist: track.artist,
              album: track.album,
              artwork: [
                { src: track.artworkMedium, sizes: '512x512', type: 'image/jpeg' },
                { src: track.artworkLarge, sizes: '1000x1000', type: 'image/jpeg' }
              ]
            });
          } catch (e) {}
        },

        updateMediaSessionPlaybackState() {
          if (!('mediaSession' in navigator)) return;
          try {
            navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
            this.updateMediaSessionPosition();
          } catch (e) {}
        },

        updateMediaSessionPosition() {
          if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
          if (!audio.duration || isNaN(audio.duration)) return;
          try {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(audio.currentTime || 0, audio.duration)
            });
          } catch (e) {}
        },

        setupMediaSessionHandlers() {
          if (!('mediaSession' in navigator)) return;
          const handlers = [
            ['play', () => audio.play().catch(() => {})],
            ['pause', () => audio.pause()],
            ['previoustrack', () => this.prevTrack()],
            ['nexttrack', () => this.nextTrack()],
            ['seekto', (details) => {
              if (details.seekTime !== undefined) this.seekToSeconds(details.seekTime);
            }],
            ['seekbackward', (details) => {
              this.seekToSeconds((audio.currentTime || 0) - (details.seekOffset || 10));
            }],
            ['seekforward', (details) => {
              this.seekToSeconds((audio.currentTime || 0) + (details.seekOffset || 10));
            }]
          ];

          for (const [action, handler] of handlers) {
            try {
              navigator.mediaSession.setActionHandler(action, handler);
            } catch (e) {}
          }
        }
      };

      /* ======================================================================
         6. CONTROLADOR DE LETRAS SINCRONIZADAS (KARAOKE & ESTÁTICA)
         ====================================================================== */
      const LyricsController = {
        async loadForTrack(track) {
          this.renderLoading();
          const result = await ApiService.fetchLyrics(track);
          // Garante que o usuário não mudou de música enquanto a letra carregava
          if (state.currentTrack?.trackId !== track.trackId) return;

          state.currentLyrics = result;
          state.activeLyricIndex = -1;
          this.renderLyricsMarkup();
        },

        renderLoading() {
          const msg = `<div class="flex flex-col items-center justify-center py-16 text-white/50 gap-2">
            <div class="w-6 h-6 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            <span class="text-xs">Buscando letra no LRCLIB...</span>
          </div>`;
          document.getElementById('desktop-lyrics-body').innerHTML = msg;
          document.getElementById('fs-lyrics-container').innerHTML = msg;
          document.getElementById('desktop-lyrics-badge').textContent = 'BUSCANDO';
        },

        renderLyricsMarkup() {
          const lyrics = state.currentLyrics;
          const desktopBody = document.getElementById('desktop-lyrics-body');
          const fsContainer = document.getElementById('fs-lyrics-container');
          const badge = document.getElementById('desktop-lyrics-badge');

          if (!lyrics || lyrics.type === 'none' || lyrics.lines.length === 0) {
            const emptyHtml = `<div class="text-center py-16 space-y-2">
              <p class="text-sm font-medium text-white/60">Letra não encontrada para esta faixa</p>
              <p class="text-xs text-white/40">Disponível para milhões de músicas no banco aberto LRCLIB</p>
            </div>`;
            desktopBody.innerHTML = emptyHtml;
            fsContainer.innerHTML = emptyHtml;
            badge.textContent = 'INDISPONÍVEL';
            return;
          }

          const isSynced = lyrics.type === 'synced';
          badge.textContent = isSynced ? 'SINCRONIZADA' : 'ESTÁTICA';

          const buildHtml = (sizeClass) => lyrics.lines.map((line, index) => {
            const timeAttr = isSynced ? `data-time="${line.time}"` : '';
            const cursorClass = isSynced ? 'synced cursor-pointer' : '';
            return `<p data-lyric-idx="${index}" ${timeAttr} class="lyric-line ${cursorClass} ${sizeClass} font-bold leading-snug tracking-tight py-1">${UI.escapeHtml(line.text)}</p>`;
          }).join('');

          desktopBody.innerHTML = buildHtml('text-lg');
          fsContainer.innerHTML = buildHtml('text-2xl sm:text-3xl');

          // Permite clicar em qualquer verso sincronizado para avançar/voltar a música
          if (isSynced) {
            [desktopBody, fsContainer].forEach(container => {
              container.querySelectorAll('[data-time]').forEach(el => {
                el.addEventListener('click', () => {
                  const targetSec = parseFloat(el.getAttribute('data-time'));
                  if (!isNaN(targetSec)) {
                    AudioEngine.seekToSeconds(targetSec);
                    if (audio.paused) audio.play().catch(() => {});
                  }
                });
              });
            });
          }
        },

        syncTime(currentSec) {
          const lyrics = state.currentLyrics;
          if (!lyrics || lyrics.type !== 'synced' || lyrics.lines.length === 0) return;

          // Encontra a linha ativa atual (com leve antecipação de 0.15s para leitura natural)
          const adjustedTime = currentSec + 0.15;
          let foundIdx = -1;
          for (let i = 0; i < lyrics.lines.length; i++) {
            if (adjustedTime >= lyrics.lines[i].time) {
              foundIdx = i;
            } else {
              break;
            }
          }

          if (foundIdx === state.activeLyricIndex) return;
          state.activeLyricIndex = foundIdx;

          [
            document.getElementById('desktop-lyrics-body'),
            document.getElementById('fs-lyrics-container')
          ].forEach(container => {
            if (!container || container.offsetParent === null) return;
            const nodes = container.querySelectorAll('.lyric-line');
            nodes.forEach((node, idx) => {
              node.classList.remove('active', 'past');
              if (idx === foundIdx) {
                node.classList.add('active');
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else if (idx < foundIdx) {
                node.classList.add('past');
              }
            });
          });
        }
      };

      /* ======================================================================
         7. INTERFACE DO USUÁRIO, MODAIS & RENDERIZAÇÃO RESPONSIVA
         ====================================================================== */
      const UI = {
        async setMiniPlayer(enabled) {
          if (!window.electronAPI?.toggleMiniPlayer) return false;
          try {
            await window.electronAPI.toggleMiniPlayer(enabled);
            state.isMiniPlayer = Boolean(enabled);
            document.body.classList.toggle('is-mini-player', state.isMiniPlayer);
            if (enabled) {
              this.updateMiniPlayerFromCurrentTrack();
            }
            return true;
          } catch (error) {
            console.warn('Não foi possível alterar o modo mini-player:', error);
            return false;
          }
        },

        updateMiniPlayerFromCurrentTrack() {
          if (!state.currentTrack) return;
          const track = state.currentTrack;
          const cover = document.getElementById('mini-player-cover');
          const title = document.getElementById('mini-player-title');
          const artist = document.getElementById('mini-player-artist');
          if (cover) cover.src = track.artworkMedium || track.artworkLarge || './glassmusic.svg';
          if (title) title.textContent = track.title;
          if (artist) artist.textContent = track.artist;
        },

        escapeHtml(str) {
          return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        },

        startInlineRename(titleElement, playlist, onRenamed) {
          if (!titleElement || !playlist) return;
          const originalName = playlist.name;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = originalName;
          input.className = 'w-full max-w-md bg-black/35 text-white border border-white/20 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-white/40';
          titleElement.replaceChildren(input);
          input.focus();
          input.select();

          let finished = false;
          const finish = (save) => {
            if (finished) return;
            finished = true;
            let resolvedName = originalName;
            if (save) {
              const newName = input.value.trim();
              if (newName) {
                Storage.renamePlaylist(playlist.id, newName);
                resolvedName = newName;
              }
            }
            if (typeof onRenamed === 'function') onRenamed(resolvedName);
          };

          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              input.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              finish(false);
              input.blur();
            }
          });
          input.addEventListener('blur', () => finish(true));
        },

        formatTime(seconds) {
          if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
          const mins = Math.floor(seconds / 60);
          const secs = Math.floor(seconds % 60);
          return `${mins}:${secs.toString().padStart(2, '0')}`;
        },

        showToast(message, type = 'info') {
          const container = document.getElementById('toast-container');
          const toast = document.createElement('div');
          const iconName = type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle-2' : 'sparkles');
          toast.className = 'glass-panel-elevated pointer-events-auto rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-xs text-white shadow-xl transition-all duration-300 translate-y-0 opacity-100';
          toast.innerHTML = `
            <i data-lucide="${iconName}" class="w-4 h-4 accent-text shrink-0"></i>
            <span class="leading-snug">${this.escapeHtml(message)}</span>
          `;
          container.appendChild(toast);
          lucide.createIcons({ root: toast });

          setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-8px)';
            setTimeout(() => toast.remove(), 300);
          }, 3400);
        },

        updateQueueBadge() {
          const count = state.priorityQueue.length + state.queue.length;
          ['queue-count-desktop', 'queue-count-mobile'].forEach(id => {
            const badge = document.getElementById(id);
            if (!badge) return;
            badge.textContent = String(count);
            badge.classList.toggle('hidden', count === 0);
            badge.classList.toggle('flex', count > 0);
          });
        },

        toggleQueueDrawer(forceOpen = null) {
          state.isQueueOpen = typeof forceOpen === 'boolean' ? forceOpen : !state.isQueueOpen;
          document.getElementById('queue-drawer').classList.toggle('open', state.isQueueOpen);
          document.getElementById('queue-backdrop').classList.toggle('open', state.isQueueOpen);
          if (state.isQueueOpen) this.renderQueueDrawer();
        },

        renderQueueDrawer() {
          this.updateQueueBadge();
          const autoplayToggle = document.getElementById('toggle-autoplay-radio');
          const autoplayKnob = document.getElementById('toggle-autoplay-knob');
          if (autoplayToggle) {
            autoplayToggle.setAttribute('aria-checked', String(state.autoPlayEnabled));
            if (autoplayToggle.lastElementChild) {
              autoplayToggle.lastElementChild.style.backgroundColor =
                state.autoPlayEnabled ? 'var(--accent-color)' : 'rgba(255,255,255,0.16)';
            }
          }
          if (autoplayKnob) {
            autoplayKnob.style.transform = state.autoPlayEnabled
              ? 'translateX(20px)'
              : 'translateX(0px)';
          }
          document.querySelectorAll('[data-queue-tab]').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.queueTab === state.queueTab);
          });
          const content = document.getElementById('queue-drawer-content');
          if (!content) return;

          if (state.queueTab === 'history') {
            content.innerHTML = state.history.length
              ? state.history.map((track, index) => `
                  <div class="queue-track-row flex items-center gap-3 px-2 py-2 rounded-2xl hover:bg-white/[0.06] mb-1">
                    <img src="${this.escapeHtml(track.artworkMedium)}" class="w-11 h-11 rounded-xl object-cover border border-white/10" alt="">
                    <button data-history-play="${this.escapeHtml(track.trackId)}" class="min-w-0 flex-1 text-left">
                      <p class="text-xs font-semibold text-white truncate">${this.escapeHtml(track.title)}</p>
                      <p class="text-[11px] text-white/45 truncate mt-0.5">${this.escapeHtml(track.artist)}</p>
                    </button>
                    <button data-history-remove="${this.escapeHtml(track.trackId)}" class="p-2 rounded-lg text-white/35 hover:text-white" title="Remover do histórico">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>`).join('')
              : '<div class="text-center text-xs text-white/45 py-12">Nenhuma música no histórico.</div>';
            lucide.createIcons({ root: content });
            content.querySelectorAll('[data-history-play]').forEach(button => {
              button.addEventListener('click', () => {
                const track = state.history.find(t => t.trackId === button.dataset.historyPlay);
                if (track) AudioEngine.playNow(track);
              });
            });
            content.querySelectorAll('[data-history-remove]').forEach(button => {
              button.addEventListener('click', () => {
                state.history = state.history.filter(t => t.trackId !== button.dataset.historyRemove);
                Storage.saveHistory();
                this.renderQueueDrawer();
              });
            });
            return;
          }

          const priorityHtml = state.priorityQueue.map((track, index) => this.queueRowTemplate(track, index, 'priority')).join('');
          const queueHtml = state.queue.map((track, index) => this.queueRowTemplate(track, index, 'queue')).join('');
          content.innerHTML = `
            <section class="mb-4">
              <p class="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Tocando agora</p>
              ${state.currentTrack ? this.queueRowTemplate(state.currentTrack, -1, 'current') : '<p class="px-2 text-xs text-white/45">Nenhuma faixa tocando.</p>'}
            </section>
            <section class="mb-4">
              <p class="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/70">A seguir</p>
              ${priorityHtml || '<p class="px-2 text-xs text-white/45">Nada na prioridade.</p>'}
            </section>
            <section>
              <p class="px-2 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Próximas na fila</p>
              ${queueHtml || '<p class="px-2 text-xs text-white/45">A fila está vazia.</p>'}
            </section>`;
          lucide.createIcons({ root: content });

          content.querySelectorAll('[data-remove-queue]').forEach(button => {
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              AudioEngine.removeFromQueue(
                button.dataset.removeQueue,
                button.dataset.listType,
                Number(button.dataset.queueIndex)
              );
            });
          });
          content.querySelectorAll('[data-move-queue]').forEach(button => {
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const from = Number(button.dataset.moveQueue);
              AudioEngine.reorderQueue(from, from + Number(button.dataset.direction));
            });
          });
          content.querySelectorAll('[data-queue-play]').forEach(button => {
            button.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const listType = button.dataset.listType;
              const index = Number(button.dataset.queueIndex);
              const list = listType === 'priority' ? state.priorityQueue : state.queue;
              const track = list[index];
              if (track) {
                if (listType === 'priority' && index >= 0) {
                  state.priorityQueue.splice(index, 1);
                } else if (listType === 'queue' && index >= 0) {
                  state.queue.splice(index, 1);
                }
                Storage.saveQueue();
                AudioEngine.playNow(track);
                UI.renderQueueDrawer();
              }
            });
          });

          let draggedIndex = null;
          content.querySelectorAll('[data-draggable-index]').forEach(row => {
            row.addEventListener('dragstart', () => {
              draggedIndex = Number(row.dataset.draggableIndex);
              row.classList.add('dragging');
            });
            row.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', event => event.preventDefault());
            row.addEventListener('drop', event => {
              event.preventDefault();
              const targetIndex = Number(row.dataset.draggableIndex);
              if (draggedIndex !== null) AudioEngine.reorderQueue(draggedIndex, targetIndex);
            });
          });
        },

        queueRowTemplate(track, index, listType) {
          const trackId = track.trackId || track.id || track.videoId || '';
          const controls = listType === 'current'
            ? ''
            : `<button type="button" data-queue-play="${this.escapeHtml(trackId)}" data-list-type="${listType}" data-queue-index="${index}" class="queue-action-button p-1.5 rounded-lg text-white/45 hover:text-white" title="Tocar agora"><i data-lucide="play" class="w-3.5 h-3.5"></i></button>
               ${listType === 'queue' ? `
                 <button type="button" data-move-queue="${index}" data-direction="-1" class="queue-action-button p-1.5 rounded-lg text-white/35 hover:text-white ${index === 0 ? 'opacity-25' : ''}" title="Subir"><i data-lucide="chevron-up" class="w-3.5 h-3.5"></i></button>
                 <button type="button" data-move-queue="${index}" data-direction="1" class="queue-action-button p-1.5 rounded-lg text-white/35 hover:text-white ${index === state.queue.length - 1 ? 'opacity-25' : ''}" title="Descer"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>` : ''}
               <button type="button" data-remove-queue="${this.escapeHtml(trackId)}" data-list-type="${listType}" data-queue-index="${index}" class="queue-action-button p-1.5 rounded-lg text-white/35 hover:text-rose-400" title="Remover"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>`;
          return `
            <div class="queue-track-row flex items-center gap-3 px-2 py-2 rounded-2xl ${listType === 'current' ? 'bg-white/[0.08] border border-white/[0.08]' : 'hover:bg-white/[0.06]'} mb-1"
                 ${listType === 'queue' ? `draggable="true" data-draggable-index="${index}"` : ''}>
              <img src="${this.escapeHtml(track.artworkMedium)}" class="w-11 h-11 rounded-xl object-cover border border-white/10" alt="">
              <div class="min-w-0 flex-1">
                <p class="text-xs font-semibold text-white truncate">${this.escapeHtml(track.title)}</p>
                <p class="text-[11px] text-white/45 truncate mt-0.5">${this.escapeHtml(track.artist)}</p>
              </div>
              <div class="queue-actions flex items-center shrink-0 relative z-[2] pointer-events-auto">${controls}</div>
            </div>`;
        },

        openTrackOptions(track, anchor, event) {
          event?.preventDefault?.();
          const menu = document.getElementById('track-options-menu');
          menu.innerHTML = `
            <button data-track-menu-action="play-now" class="w-full px-3 py-2.5 rounded-xl text-left text-xs text-white/80 hover:text-white hover:bg-white/[0.08] flex items-center gap-2"><i data-lucide="play" class="w-4 h-4"></i>Tocar agora</button>
            <button data-track-menu-action="play-next" class="w-full px-3 py-2.5 rounded-xl text-left text-xs text-white/80 hover:text-white hover:bg-white/[0.08] flex items-center gap-2"><i data-lucide="corner-down-right" class="w-4 h-4"></i>Tocar a seguir</button>
            <button data-track-menu-action="add-queue" class="w-full px-3 py-2.5 rounded-xl text-left text-xs text-white/80 hover:text-white hover:bg-white/[0.08] flex items-center gap-2"><i data-lucide="list-plus" class="w-4 h-4"></i>Adicionar à fila</button>
            <button data-track-menu-action="add-playlist" class="w-full px-3 py-2.5 rounded-xl text-left text-xs text-white/80 hover:text-white hover:bg-white/[0.08] flex items-center gap-2"><i data-lucide="library" class="w-4 h-4"></i>Adicionar à Playlist</button>`;
          const rect = anchor?.getBoundingClientRect?.();
          menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 200, rect?.left ?? event?.clientX ?? 8))}px`;
          menu.style.top = `${Math.max(8, Math.min(window.innerHeight - 190, rect?.bottom ?? event?.clientY ?? 8))}px`;
          menu.classList.remove('hidden');
          lucide.createIcons({ root: menu });
          menu.querySelectorAll('[data-track-menu-action]').forEach(button => {
            button.onclick = () => {
              menu.classList.add('hidden');
              if (button.dataset.trackMenuAction === 'play-now') AudioEngine.playNow(track);
              if (button.dataset.trackMenuAction === 'play-next') AudioEngine.playNext(track);
              if (button.dataset.trackMenuAction === 'add-queue') AudioEngine.addToQueue(track);
              if (button.dataset.trackMenuAction === 'add-playlist') this.openAddToPlaylistModal(track);
            };
          });
        },

        openImportPlaylistsModal() {
          document.getElementById('import-playlists-modal')?.classList.remove('hidden');
          this.renderImportedPlaylists();
        },

        closeImportPlaylistsModal() {
          document.getElementById('import-playlists-modal')?.classList.add('hidden');
        },

        renderImportedPlaylists() {
          const container = document.getElementById('imported-playlists-list');
          if (!container) return;
          if (!state.playlists.length) {
            container.innerHTML = '<p class="text-xs text-white/45 text-center py-6">Nenhuma playlist salva ainda.</p>';
            return;
          }
          container.innerHTML = state.playlists.map((playlist) => {
            const cover = playlist.cover || playlist.tracks?.[0]?.artworkMedium || 'https://placehold.co/200x200/10131c/64748b?text=Playlist';
            return `
              <div class="glass-panel rounded-2xl p-3 flex items-center gap-3">
                <img src="${this.escapeHtml(cover)}" alt="" class="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0" />
                <button data-imported-open="${this.escapeHtml(playlist.id)}" class="min-w-0 flex-1 text-left">
                  <p class="text-sm font-semibold text-white truncate">${this.escapeHtml(playlist.name)}</p>
                  <p class="text-[11px] text-white/45 mt-0.5">${playlist.tracks?.length || 0} músicas</p>
                </button>
                <button data-imported-play="${this.escapeHtml(playlist.id)}" class="accent-btn p-2 rounded-xl" title="Tocar playlist">
                  <i data-lucide="play" class="w-4 h-4 fill-current"></i>
                </button>
                <button data-imported-delete="${this.escapeHtml(playlist.id)}" class="glass-chip p-2 rounded-xl text-white/55 hover:text-rose-400" title="Excluir playlist">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </div>`;
          }).join('');
          lucide.createIcons({ root: container });

          container.querySelectorAll('[data-imported-play]').forEach((button) => {
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              const playlist = state.playlists.find((item) => item.id === button.dataset.importedPlay);
              if (!playlist?.tracks?.length) return;
              AudioEngine.playNow(playlist.tracks[0], playlist.tracks);
              this.closeImportPlaylistsModal();
              this.showToast(`Playlist "${playlist.name}" iniciada`, 'success');
            });
          });
          container.querySelectorAll('[data-imported-delete]').forEach((button) => {
            button.addEventListener('click', async (event) => {
              event.stopPropagation();
              const playlist = state.playlists.find((item) => item.id === button.dataset.importedDelete);
              if (!playlist) return;
              const confirmed = await this.openConfirm('Excluir Playlist', `Deseja excluir "${playlist.name}"?`);
              if (!confirmed) return;
              state.playlists = state.playlists.filter((item) => item.id !== playlist.id);
              Storage.savePlaylists();
              this.renderSidebarPlaylists();
              this.renderImportedPlaylists();
              this.showToast('Playlist excluída');
            });
          });
          container.querySelectorAll('[data-imported-open]').forEach((button) => {
            button.addEventListener('click', () => {
              this.closeImportPlaylistsModal();
              this.switchView('playlist-detail', button.dataset.importedOpen);
            });
          });
        },

        parseCsvText(text) {
          const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (!rows.length) return [];
          const splitCsv = (line) => {
            const values = [];
            let current = '';
            let quoted = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"' && line[i + 1] === '"') {
                current += '"';
                i++;
              } else if (char === '"') {
                quoted = !quoted;
              } else if (char === ',' && !quoted) {
                values.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            values.push(current.trim());
            return values;
          };
          const first = splitCsv(rows[0]).map((value) => value.trim().toLocaleLowerCase());
          const hasHeader = first.some((value) => ['title', 'track', 'track name', 'artist', 'album', 'duration'].includes(value));
          const headers = hasHeader ? first : ['track', 'artist', 'album', 'duration'];
          const start = hasHeader ? 1 : 0;
          return rows.slice(start).map((row, index) => {
            const values = splitCsv(row);
            const record = {};
            headers.forEach((header, column) => { record[header] = values[column] || ''; });
            const title = record.title || record.track || record['track name'] || record.name;
            const artist = record.artist || record.artists || record.artistname || '';
            const album = record.album || record.albumname || 'Arquivo importado';
            if (!title) return null;
            const durationParts = String(record.duration || '3:00').split(':').map(Number);
            const durationSec = durationParts.length === 2
              ? Math.max(1, durationParts[0] * 60 + (durationParts[1] || 0))
              : 180;
            return {
              trackId: `file-${index}-${title}-${artist}`,
              title: title.trim(),
              artist: (artist || 'Artista desconhecido').trim(),
              album: album.trim(),
              durationSec,
              artworkMedium: 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music',
              artworkLarge: 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
              previewUrl: ''
            };
          }).filter(Boolean);
        },

        parseTxtText(text) {
          return text.split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => {
              const separator = line.includes(' - ') ? ' - ' : (line.includes('|') ? '|' : null);
              let artist = 'Artista desconhecido';
              let title = line;
              if (separator) {
                const parts = line.split(separator).map((value) => value.trim()).filter(Boolean);
                if (parts.length >= 2) {
                  artist = parts[0];
                  title = parts.slice(1).join(' - ');
                }
              }
              return {
                trackId: `txt-${index}-${title}-${artist}`,
                title,
                artist,
                album: 'Arquivo importado',
                durationSec: 180,
                artworkMedium: 'https://placehold.co/600x600/10131c/64748b?text=Glass+Music',
                artworkLarge: 'https://placehold.co/1000x1000/10131c/64748b?text=Glass+Music',
                previewUrl: ''
              };
            });
        },

        openConfirm(title, description) {
          return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            document.getElementById('confirm-modal-title').textContent = title;
            document.getElementById('confirm-modal-desc').textContent = description;
            modal.classList.remove('hidden');

            const cleanup = (result) => {
              modal.classList.add('hidden');
              btnOk.removeEventListener('click', onOk);
              btnCancel.removeEventListener('click', onCancel);
              resolve(result);
            };
            const onOk = () => cleanup(true);
            const onCancel = () => cleanup(false);

            const btnOk = document.getElementById('btn-confirm-ok');
            const btnCancel = document.getElementById('btn-confirm-cancel');
            btnOk.addEventListener('click', onOk);
            btnCancel.addEventListener('click', onCancel);
          });
        },

        renderGenreChips() {
          const container = document.getElementById('genre-chips-bar');
          container.innerHTML = DISCOVERY_CHIPS.map(chip => {
            const active = state.currentView === 'explore' && state.activeDiscoveryCategory === chip.category ? 'active' : '';
            return `<button data-query="${this.escapeHtml(chip.query)}" data-category="${this.escapeHtml(chip.category)}" class="glass-chip ${active} px-3.5 py-1.5 rounded-full text-xs font-medium text-white/80 whitespace-nowrap shrink-0">
              ${this.escapeHtml(chip.label)}
            </button>`;
          }).join('');

          container.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
              const q = btn.getAttribute('data-query');
              const category = btn.getAttribute('data-category');
              state.activeChipQuery = q;
              state.activeDiscoveryCategory = category;
              document.getElementById('search-input').value = '';
              document.getElementById('btn-clear-search').classList.add('hidden');
              this.switchView('explore');
              this.loadExploreTracks(q, btn.textContent.trim(), category);
            });
          });
        },

        renderAccentPresets() {
          const container = document.getElementById('accent-presets-list');
          container.innerHTML = ACCENT_PRESETS.map(preset => {
            const isSelected = state.settings.accentColor.toLowerCase() === preset.hex.toLowerCase();
            return `<button type="button" data-hex="${preset.hex}" title="${preset.name}"
              class="w-7 h-7 rounded-full transition-transform hover:scale-110 ${isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-black scale-110' : ''}"
              style="background-color: ${preset.hex}; box-shadow: 0 0 14px ${preset.hex}80;">
            </button>`;
          }).join('');

          container.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
              state.settings.accentMode = 'manual';
              state.settings.accentColor = btn.getAttribute('data-hex');
              Storage.saveSettings();
              ThemeEngine.applyAll();
              this.renderAccentPresets();
            });
          });
        },

        showLoadingSkeletons(count = 10) {
          const loadingGrid = document.getElementById('loading-grid');
          const tracksGrid = document.getElementById('tracks-grid');
          document.getElementById('empty-state').classList.add('hidden');
          tracksGrid.classList.add('hidden');
          loadingGrid.classList.remove('hidden');

          loadingGrid.innerHTML = Array.from({ length: count }).map(() => `
            <div class="glass-card rounded-3xl p-3 space-y-3 animate-pulse">
              <div class="w-full aspect-square rounded-2xl bg-white/10"></div>
              <div class="h-3.5 bg-white/10 rounded-full w-3/4"></div>
              <div class="h-3 bg-white/5 rounded-full w-1/2"></div>
            </div>
          `).join('');
        },

        async loadExploreTracks(query, labelTitle = null, category = null) {
          this.renderGenreChips();
          this.showLoadingSkeletons(10);
          document.getElementById('section-title').textContent = labelTitle || `Resultados para "${query}"`;
          document.getElementById('section-subtitle').textContent = 'Catálogo em alta definição • Clique para reproduzir instantaneamente';
          document.getElementById('section-actions').innerHTML = '';

          try {
            const tracks = category
              ? await ApiService.discoverTracks(category)
              : await ApiService.searchTracks(query, 25);
            state.displayedTracks = tracks;
            this.renderTracksGrid(tracks, { context: 'search' });

            // Define capa inicial de iluminação ambiente na primeira carga
            if (!state.currentTrack && tracks.length > 0) {
              ThemeEngine.setAmbientArtwork(tracks[0].artworkLarge);
            }
          } catch (err) {
            document.getElementById('loading-grid').classList.add('hidden');
            this.showToast('Não foi possível conectar à busca do iTunes.', 'error');
          }
        },

        renderTracksGrid(tracks, options = {}) {
          const loadingGrid = document.getElementById('loading-grid');
          const tracksGrid = document.getElementById('tracks-grid');
          const emptyState = document.getElementById('empty-state');
          const mobilePlView = document.getElementById('mobile-playlists-view');

          loadingGrid.classList.add('hidden');
          mobilePlView.classList.add('hidden');

          if (!tracks || tracks.length === 0) {
            tracksGrid.classList.add('hidden');
            emptyState.classList.remove('hidden');
            document.getElementById('empty-state-title').textContent = options.emptyTitle || 'Nenhuma faixa encontrada';
            document.getElementById('empty-state-desc').textContent = options.emptyDesc || 'Tente buscar por outro artista ou explore os gêneros acima.';
            return;
          }

          emptyState.classList.add('hidden');
          tracksGrid.classList.remove('hidden');

          if (options.context === 'playlist') {
            tracksGrid.className = 'flex flex-col gap-2';
            tracksGrid.innerHTML = tracks.map((track, idx) => `
              <article data-track-idx="${idx}" class="glass-card rounded-2xl px-3 py-2.5 flex items-center gap-3 group cursor-pointer">
                <img src="${this.escapeHtml(track.artworkMedium || track.artworkLarge)}" alt="" class="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0" />
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold text-white truncate">
                    ${track.explicit ? '<span class="inline-flex mr-1 px-1 py-0.5 rounded border border-white/20 text-[9px] text-white/60">E</span>' : ''}
                    ${this.escapeHtml(track.title)}
                  </h3>
                  <p class="text-xs text-white/55 truncate">${this.escapeHtml(track.artist)} • ${this.escapeHtml(track.album)}</p>
                </div>
                <span class="font-mono-tech text-[10px] text-white/45 shrink-0">${this.formatTime(track.durationSec)}</span>
                <div class="relative z-[2] flex items-center gap-1 pointer-events-auto opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                  <button data-action="playlist-up" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 ${idx === 0 ? 'opacity-30 pointer-events-none' : ''}" title="Mover para cima">
                    <i data-lucide="chevron-up" class="w-3.5 h-3.5"></i>
                  </button>
                  <button data-action="playlist-down" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 ${idx === tracks.length - 1 ? 'opacity-30 pointer-events-none' : ''}" title="Mover para baixo">
                    <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i>
                  </button>
                  <button data-action="playlist-remove" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-rose-400 hover:bg-rose-500/10" title="Remover da playlist">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </article>
            `).join('');
            lucide.createIcons({ root: tracksGrid });
          } else {
          tracksGrid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 md:gap-4 pb-6';
          const favIds = new Set(state.favorites.map(f => f.trackId));

          tracksGrid.innerHTML = tracks.map((track, idx) => {
            const isPlayingThis = state.currentTrack?.trackId === track.trackId;
            const isFav = favIds.has(track.trackId);

            return `
              <article data-track-idx="${idx}" class="glass-card ${isPlayingThis ? 'is-playing' : ''} group rounded-3xl p-3 flex flex-col justify-between cursor-pointer relative">
                <div>
                  <div class="relative w-full aspect-square rounded-2xl overflow-hidden bg-white/5 mb-3 border border-white/10">
                    <img
                      src="${this.escapeHtml(track.artworkMedium)}"
                      alt="${this.escapeHtml(track.title)}"
                      loading="lazy"
                      class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <!-- Overlay de Play -->
                    <div class="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2.5">
                      <button data-action="fav" data-idx="${idx}" class="w-9 h-9 rounded-xl bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-white hover:scale-105 transition" title="Favoritar">
                        <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-rose-500 text-rose-500' : ''}"></i>
                      </button>
                      <div class="flex items-center gap-1.5">
                        <button data-action="play-next" data-idx="${idx}" class="w-9 h-9 rounded-xl bg-black/55 backdrop-blur-md border border-white/15 flex items-center justify-center text-white hover:scale-105 transition" title="Tocar a seguir">
                          <i data-lucide="corner-down-right" class="w-4 h-4"></i>
                        </button>
                        <button data-action="play" data-idx="${idx}" class="accent-btn w-10 h-10 rounded-xl flex items-center justify-center" title="Tocar agora">
                          <i data-lucide="${isPlayingThis && state.isPlaying ? 'pause' : 'play'}" class="w-4 h-4 fill-current ${isPlayingThis && state.isPlaying ? '' : 'ml-0.5'}"></i>
                        </button>
                      </div>
                    </div>
                    <!-- Selo de Duração -->
                    <span class="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/55 backdrop-blur-md font-mono-tech text-[10px] text-white/85 border border-white/10">
                      ${this.formatTime(track.durationSec)}
                    </span>
                  </div>

                  <h3 class="text-sm font-semibold text-white truncate leading-snug" title="${this.escapeHtml(track.title)}">
                    ${track.explicit ? '<span class="inline-flex align-middle mr-1 px-1 py-0.5 rounded border border-white/20 text-[9px] leading-none text-white/60" title="Conteúdo explícito">E</span>' : ''}
                    ${this.escapeHtml(track.title)}
                  </h3>
                  <p class="text-xs text-white/55 truncate mt-0.5" title="${this.escapeHtml(track.artist)}">
                    ${this.escapeHtml(track.artist)}
                  </p>
                </div>

                <div class="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between">
                  <span class="text-[11px] text-white/40 truncate max-w-[65%]">${this.escapeHtml(track.album)}</span>
                  <div class="flex items-center gap-1">
                    <button data-action="fav" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-rose-400 transition md:hidden" title="Favoritar">
                      <i data-lucide="heart" class="w-3.5 h-3.5 ${isFav ? 'fill-rose-500 text-rose-500' : ''}"></i>
                    </button>
                    <button data-action="add-pl" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 transition" title="Adicionar à Playlist">
                      <i data-lucide="list-plus" class="w-3.5 h-3.5"></i>
                    </button>
                    <button data-action="menu" data-idx="${idx}" class="p-1.5 rounded-lg text-white/45 hover:text-white hover:bg-white/10 transition" title="Mais opções">
                      <i data-lucide="more-horizontal" class="w-3.5 h-3.5"></i>
                    </button>
                  </div>
                </div>
              </article>
            `;
          }).join('');
          }

          lucide.createIcons({ root: tracksGrid });

          // Vincula eventos de toque/clique nos cards
          tracksGrid.querySelectorAll('article[data-track-idx]').forEach(card => {
            card.addEventListener('click', (e) => {
              const actionBtn = e.target.closest('button[data-action]');
              const idx = parseInt(card.getAttribute('data-track-idx'), 10);
              const track = tracks[idx];
              if (!track) return;

              if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.getAttribute('data-action');
                if (action === 'fav') {
                  this.toggleFavorite(track);
                } else if (action === 'add-pl') {
                  this.openAddToPlaylistModal(track);
                } else if (action === 'play-next') {
                  AudioEngine.playNext(track);
                } else if (action === 'menu') {
                  this.openTrackOptions(track, actionBtn, e);
                } else if (action === 'playlist-up' || action === 'playlist-down' || action === 'playlist-remove') {
                  const playlist = state.playlists.find((item) => item.id === state.activePlaylistId);
                  if (!playlist) return;
                  if (action === 'playlist-remove') {
                    Storage.removeTrackFromPlaylist(playlist.id, idx);
                  } else if (action === 'playlist-up' && idx > 0) {
                    Storage.moveTrackInPlaylist(playlist.id, idx, idx - 1);
                  } else if (action === 'playlist-down' && idx < tracks.length - 1) {
                    Storage.moveTrackInPlaylist(playlist.id, idx, idx + 1);
                  }
                  this.renderCurrentView();
                } else if (action === 'play') {
                  if (state.currentTrack?.trackId === track.trackId) {
                    AudioEngine.togglePlayPause();
                  } else {
                    if (options.context === 'favorites' || options.context === 'playlist') {
                      AudioEngine.playNow(track, tracks);
                    } else {
                      AudioEngine.playNow(track);
                    }
                  }
                }
                return;
              }

              if (options.context === 'favorites' || options.context === 'playlist') {
                AudioEngine.playNow(track, tracks);
              } else {
                AudioEngine.playNow(track);
              }
            });

            card.addEventListener('contextmenu', (event) => {
              event.preventDefault();
              const idx = parseInt(card.getAttribute('data-track-idx'), 10);
              const track = tracks[idx];
              if (track) this.openTrackOptions(track, card, event);
            });
          });
        },

        switchView(viewName, playlistId = null) {
          state.currentView = viewName;
          state.activePlaylistId = playlistId;

          // Atualiza destaque da navegação Desktop & Mobile
          document.querySelectorAll('.nav-item').forEach(el => {
            el.classList.toggle('active', el.getAttribute('data-view') === viewName);
          });
          document.querySelectorAll('.mobile-nav-item').forEach(el => {
            const isMatch = el.getAttribute('data-view') === viewName ||
              (viewName === 'playlist-detail' && el.getAttribute('data-view') === 'playlists');
            el.classList.toggle('active', isMatch);
            el.classList.toggle('text-white', isMatch);
            el.classList.toggle('text-white/55', !isMatch);
          });

          this.renderGenreChips();
          this.renderCurrentView();
        },

        renderCurrentView() {
          const titleEl = document.getElementById('section-title');
          const subEl = document.getElementById('section-subtitle');
          const actionsEl = document.getElementById('section-actions');
          const mobilePlView = document.getElementById('mobile-playlists-view');

          mobilePlView.classList.add('hidden');
          actionsEl.innerHTML = '';

          if (state.currentView === 'explore') {
            if (state.displayedTracks.length === 0) {
              this.loadExploreTracks(
                state.activeChipQuery,
                'Em Alta Agora',
                state.activeDiscoveryCategory
              );
            } else {
              this.renderTracksGrid(state.displayedTracks, { context: 'search' });
            }
            return;
          }

          if (state.currentView === 'favorites') {
            titleEl.textContent = 'Músicas Favoritas';
            subEl.textContent = `${state.favorites.length} ${state.favorites.length === 1 ? 'faixa salva' : 'faixas salvas'} localmente no navegador`;
            if (state.favorites.length > 0) {
              actionsEl.innerHTML = `<button id="btn-play-all-favs" class="accent-btn px-4 py-2 rounded-2xl text-xs flex items-center gap-1.5">
                <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
                <span>Tocar Tudo</span>
              </button>`;
              lucide.createIcons({ root: actionsEl });
              document.getElementById('btn-play-all-favs').addEventListener('click', () => {
                AudioEngine.playNow(state.favorites[0], state.favorites);
              });
            }
            state.displayedTracks = state.favorites;
            this.renderTracksGrid(state.favorites, {
              context: 'favorites',
              emptyTitle: 'Nenhum favorito ainda',
              emptyDesc: 'Toque no ícone de coração em qualquer música para salvá-la aqui.'
            });
            return;
          }

          if (state.currentView === 'history') {
            titleEl.textContent = 'Histórico de Reprodução';
            subEl.textContent = 'Suas faixas ouvidas recentemente';
            if (state.history.length > 0) {
              actionsEl.innerHTML = `<button id="btn-clear-history" class="glass-chip px-3.5 py-2 rounded-2xl text-xs text-white/80 hover:text-rose-300 flex items-center gap-1.5">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>Limpar</span>
              </button>`;
              lucide.createIcons({ root: actionsEl });
              document.getElementById('btn-clear-history').addEventListener('click', async () => {
                const ok = await this.openConfirm('Limpar histórico', 'Deseja apagar todo o histórico de reprodução deste dispositivo?');
                if (ok) {
                  state.history = [];
                  Storage.saveHistory();
                  this.renderCurrentView();
                  this.showToast('Histórico limpo com sucesso.');
                }
              });
            }
            state.displayedTracks = state.history;
            this.renderTracksGrid(state.history, {
              context: 'history',
              emptyTitle: 'Histórico vazio',
              emptyDesc: 'As músicas que você reproduzir aparecerão automaticamente aqui.'
            });
            return;
          }

          if (state.currentView === 'playlists') {
            titleEl.textContent = 'Playlists';
            subEl.textContent = 'Organize suas coleções musicais sem precisar de conta';
            document.getElementById('tracks-grid').classList.add('hidden');
            document.getElementById('empty-state').classList.add('hidden');
            mobilePlView.classList.remove('hidden');
            this.renderMobilePlaylistsCards();
            return;
          }

          if (state.currentView === 'playlist-detail') {
            const pl = state.playlists.find(p => p.id === state.activePlaylistId);
            if (!pl) {
              this.switchView('explore');
              return;
            }
            const totalSeconds = (pl.tracks || []).reduce((sum, track) =>
              sum + (Number(track.durationSec) || 0), 0
            );
            const durationText = totalSeconds >= 3600
              ? `${Math.floor(totalSeconds / 3600)}h ${Math.round((totalSeconds % 3600) / 60)}min`
              : `${Math.max(1, Math.round(totalSeconds / 60))}min`;
            titleEl.innerHTML = `<span data-playlist-header-title="${this.escapeHtml(pl.id)}">${this.escapeHtml(pl.name)}</span>`;
            subEl.textContent = `Playlist Local • ${pl.tracks.length} ${pl.tracks.length === 1 ? 'música' : 'músicas'} • ${durationText}`;
            actionsEl.innerHTML = `
              ${pl.tracks.length > 0 ? `<button id="btn-play-pl" class="accent-btn px-3 py-2 rounded-2xl text-xs flex items-center gap-1.5">
                <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
                <span>Tocar Tudo</span>
              </button>
              <button id="btn-shuffle-pl" class="glass-chip px-3 py-2 rounded-2xl text-xs text-white/80 flex items-center gap-1.5">
                <i data-lucide="shuffle" class="w-3.5 h-3.5"></i>
                <span>Aleatório</span>
              </button>` : ''}
              <button id="btn-rename-pl" class="glass-chip px-3 py-2 rounded-2xl text-xs text-white/80 flex items-center gap-1.5">
                <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                <span>Renomear</span>
              </button>
              ${pl.tracks.length > 0 ? `<button id="btn-export-pl" class="glass-chip px-3 py-2 rounded-2xl text-xs text-white/80 flex items-center gap-1.5">
                <i data-lucide="download" class="w-3.5 h-3.5"></i>
                <span>Exportar CSV</span>
              </button>` : ''}
              <button id="btn-delete-pl" data-confirm-delete="0" class="glass-chip px-3 py-2 rounded-2xl text-xs text-rose-300 hover:bg-rose-500/20 flex items-center gap-1">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>Excluir</span>
              </button>
            `;
            lucide.createIcons({ root: actionsEl });

            document.getElementById('btn-play-pl')?.addEventListener('click', () => {
              AudioEngine.playNow(pl.tracks[0], pl.tracks);
            });
            document.getElementById('btn-shuffle-pl')?.addEventListener('click', () => {
              if (!pl.tracks.length) return;
              const shuffled = [...pl.tracks];
              for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
              }
              AudioEngine.playNow(shuffled[0], shuffled);
            });
            document.getElementById('btn-rename-pl')?.addEventListener('click', () => {
              const title = document.querySelector(`[data-playlist-header-title="${CSS.escape(pl.id)}"]`);
              if (title) {
                this.startInlineRename(title, pl, (name) => {
                  titleEl.textContent = name || pl.name;
                  this.renderSidebarPlaylists();
                  this.renderMobilePlaylistsCards();
                });
              }
            });
            document.getElementById('btn-export-pl')?.addEventListener('click', () => {
              if (Storage.exportPlaylistCSV(pl.id)) this.showToast('CSV da playlist exportado', 'success');
            });
            const deleteButton = document.getElementById('btn-delete-pl');
            deleteButton?.addEventListener('click', () => {
              if (deleteButton.dataset.confirmDelete !== '1') {
                deleteButton.dataset.confirmDelete = '1';
                deleteButton.querySelector('span').textContent = 'Confirmar excluir';
                deleteButton.classList.add('bg-rose-500/20');
                setTimeout(() => {
                  if (deleteButton.isConnected) {
                    deleteButton.dataset.confirmDelete = '0';
                    const label = deleteButton.querySelector('span');
                    if (label) label.textContent = 'Excluir';
                    deleteButton.classList.remove('bg-rose-500/20');
                  }
                }, 3500);
                return;
              }
              deleteButton.dataset.confirmDelete = '0';
              state.playlists = state.playlists.filter(p => p.id !== pl.id);
              Storage.savePlaylists();
              this.renderSidebarPlaylists();
              this.showToast('Playlist excluída.');
              this.switchView('explore');
            });

            state.displayedTracks = pl.tracks;
            this.renderTracksGrid(pl.tracks, {
              context: 'playlist',
              emptyTitle: 'Esta playlist está vazia',
              emptyDesc: 'Clique no ícone de lista (+) em qualquer música para adicioná-la aqui.'
            });
          }
        },

        renderSidebarPlaylists() {
          const container = document.getElementById('sidebar-playlists-list');
          if (state.playlists.length === 0) {
            container.innerHTML = `<p class="text-[11px] text-white/35 px-2.5 py-3">Nenhuma playlist criada ainda.</p>`;
            return;
          }
          container.innerHTML = state.playlists.map(pl => {
            const active = state.currentView === 'playlist-detail' && state.activePlaylistId === pl.id;
            return `<div class="group flex items-center rounded-xl ${active ? 'bg-white/15' : 'hover:bg-white/5'}">
              <button data-pl-id="${this.escapeHtml(pl.id)}" class="min-w-0 flex-1 flex items-center justify-between px-3 py-2 text-xs transition ${active ? 'text-white font-semibold' : 'text-white/70 hover:text-white'}">
                <span class="truncate pr-2">${this.escapeHtml(pl.name)}</span>
                <span class="font-mono-tech text-[10px] text-white/45 shrink-0">${pl.tracks.length}</span>
              </button>
              <button data-sidebar-rename="${this.escapeHtml(pl.id)}" class="p-2 mr-1 rounded-lg text-white/35 hover:text-white hover:bg-white/10" title="Renomear">
                <i data-lucide="pencil" class="w-3 h-3"></i>
              </button>
            </div>`;
          }).join('');

          container.querySelectorAll('button[data-sidebar-rename]').forEach(button => {
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              const playlist = state.playlists.find((item) => item.id === button.dataset.sidebarRename);
              const row = button.closest('div');
              const title = row?.querySelector('[data-pl-id] span');
              if (!playlist || !title) return;
              this.startInlineRename(title, playlist, () => {
                this.renderSidebarPlaylists();
                this.renderMobilePlaylistsCards();
              });
            });
          });

          container.querySelectorAll('button[data-pl-id]').forEach(btn => {
            btn.addEventListener('click', () => {
              this.switchView('playlist-detail', btn.getAttribute('data-pl-id'));
            });
          });
        },

        renderMobilePlaylistsCards() {
          const container = document.getElementById('mobile-playlists-cards');
          if (state.playlists.length === 0) {
            container.innerHTML = `<div class="glass-panel rounded-2xl p-6 text-center text-xs text-white/55 col-span-full">
              Toque em "Nova" acima para criar sua primeira playlist.
            </div>`;
            return;
          }
          container.innerHTML = state.playlists.map(pl => renderPlaylistCard(pl)).join('');
          lucide.createIcons({ root: container });

          container.querySelectorAll('[data-playlist-rename]').forEach(button => {
            button.addEventListener('click', (event) => {
              event.stopPropagation();
              const playlist = state.playlists.find((item) => item.id === button.dataset.playlistRename);
              const title = container.querySelector(`[data-playlist-title="${CSS.escape(playlist.id)}"]`);
              if (!playlist || !title) return;
              this.startInlineRename(title, playlist, () => {
                this.renderMobilePlaylistsCards();
                this.renderSidebarPlaylists();
              });
            });
          });

          container.querySelectorAll('[data-pl-id]').forEach(card => {
            card.addEventListener('click', (event) => {
              if (event.target.closest('[data-playlist-rename]')) return;
              this.switchView('playlist-detail', card.getAttribute('data-pl-id'));
            });
          });
        },

        toggleFavorite(track) {
          if (!track) return;
          const exists = state.favorites.some(f => f.trackId === track.trackId);
          if (exists) {
            state.favorites = state.favorites.filter(f => f.trackId !== track.trackId);
            this.showToast('Removida dos Favoritos');
          } else {
            state.favorites.unshift(Storage.sanitizeTrackMetadata(track));
            this.showToast('Adicionada aos Favoritos', 'success');
          }
          Storage.saveFavorites();
          this.updateFavoritesBadge();
          this.updateNowPlayingFavIcons();
          if (state.currentView === 'favorites' || state.currentView === 'explore') {
            this.renderCurrentView();
          }
        },

        updateFavoritesBadge() {
          document.getElementById('badge-favorites-count').textContent = state.favorites.length;
        },

        updateNowPlayingFavIcons() {
          const isFav = state.currentTrack && state.favorites.some(f => f.trackId === state.currentTrack.trackId);
          ['btn-desktop-fav', 'btn-mobile-mini-fav', 'btn-fs-fav'].forEach(btnId => {
            const icon = document.querySelector(`#${btnId} svg, #${btnId} i`);
            if (icon) {
              icon.classList.toggle('fill-rose-500', Boolean(isFav));
              icon.classList.toggle('text-rose-500', Boolean(isFav));
            }
          });
        },

        renderNowPlaying(track) {
          // Desktop footer
          document.getElementById('desktop-cover').src = track.artworkMedium;
          document.getElementById('desktop-title').textContent = track.title;
          document.getElementById('desktop-artist').textContent = track.artist;
          document.getElementById('desktop-playing-eq').classList.remove('hidden');

          // Mobile mini-player
          document.getElementById('mobile-mini-cover').src = track.artworkMedium;
          document.getElementById('mobile-mini-title').textContent = track.title;
          document.getElementById('mobile-mini-artist').textContent = track.artist;

          // Fullscreen player
          document.getElementById('fs-cover-img').src = track.artworkLarge;
          document.getElementById('fs-title').textContent = track.title;
          document.getElementById('fs-artist').textContent = `${track.artist} • ${track.album}`;

          // Mini-player flutuante
          const miniCover = document.getElementById('mini-player-cover');
          const miniTitle = document.getElementById('mini-player-title');
          const miniArtist = document.getElementById('mini-player-artist');
          if (miniCover) miniCover.src = track.artworkMedium || track.artworkLarge || './glassmusic.svg';
          if (miniTitle) miniTitle.textContent = track.title;
          if (miniArtist) miniArtist.textContent = track.artist;

          this.updateNowPlayingFavIcons();

          // Destaca card ativo na grade
          document.querySelectorAll('#tracks-grid article').forEach((card, idx) => {
            const t = state.displayedTracks[idx];
            card.classList.toggle('is-playing', t && t.trackId === track.trackId);
          });
        },

        updatePlayStateUI() {
          const iconName = state.isPlaying ? 'pause' : 'play';
          const mlClass = state.isPlaying ? '' : 'ml-0.5';

          const setBtnIcon = (btnId, sizeClass) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.innerHTML = `<i data-lucide="${iconName}" class="${sizeClass} fill-current ${mlClass}"></i>`;
            lucide.createIcons({ root: btn });
          };

          setBtnIcon('btn-desktop-play', 'w-5 h-5');
          setBtnIcon('btn-mobile-mini-play', 'w-4 h-4');
          setBtnIcon('btn-fs-play', 'w-7 h-7');
          const miniPlay = document.getElementById('btn-mini-play');
          if (miniPlay) {
            miniPlay.innerHTML = `<i id="icon-mini-play" data-lucide="${iconName}" class="w-4 h-4 fill-current"></i>`;
            miniPlay.title = state.isPlaying ? 'Pausar' : 'Reproduzir';
            lucide.createIcons({ root: miniPlay });
          }

          const eq = document.getElementById('desktop-playing-eq');
          if (eq) eq.classList.toggle('paused', !state.isPlaying);
        },

        updateBackendStatusUI() {
          const online = state.backendOnline;
          const dotSidebar = document.getElementById('backend-dot-sidebar');
          const lblSidebar = document.getElementById('backend-label-sidebar');
          const modalBadge = document.getElementById('modal-backend-status');

          if (online === true) {
            dotSidebar.className = 'w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_8px_#34d399]';
            lblSidebar.textContent = 'Node.js Proxy Ativo';
            modalBadge.className = 'text-[11px] font-mono-tech px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300';
            modalBadge.textContent = 'ONLINE (STREAM PURO)';
          } else if (online === false) {
            dotSidebar.className = 'w-2 h-2 rounded-full bg-sky-400 shrink-0';
            lblSidebar.textContent = 'Modo Preview HQ (iTunes)';
            modalBadge.className = 'text-[11px] font-mono-tech px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300';
            modalBadge.textContent = 'OFFLINE (FALLBACK HQ)';
          } else {
            dotSidebar.className = 'w-2 h-2 rounded-full bg-amber-400 shrink-0';
            lblSidebar.textContent = 'Verificando Proxy...';
            modalBadge.className = 'text-[11px] font-mono-tech px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300';
            modalBadge.textContent = 'VERIFICANDO...';
          }
        },

        // Atualiza o Selo Técnico Discreto com a qualidade real do áudio reproduzido
        updateTechnicalBadge() {
          let label = 'STANDBY • PRONTO';
          let dotClass = 'w-1.5 h-1.5 rounded-full bg-white/40';

          if (state.activeStreamSource === 'proxy') {
            label = 'OPUS 160kbps • 48kHz • Node Proxy';
            dotClass = 'w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]';
          } else if (state.activeStreamSource === 'preview') {
            label = 'AAC 256kbps • 44.1kHz • iTunes HQ';
            dotClass = 'w-1.5 h-1.5 rounded-full bg-sky-400 shadow-[0_0_8px_#38bdf8]';
          }

          document.getElementById('tech-badge-header-text').textContent = label;
          document.getElementById('tech-badge-player-text').textContent = label;
          document.getElementById('fs-tech-badge').textContent = label;
          document.getElementById('modal-tech-telemetry').textContent = label;

          document.getElementById('tech-badge-dot').className = dotClass;
          document.getElementById('fs-tech-dot').className = dotClass;
        },

        // Modais de Playlist
        openCreatePlaylistModal() {
          const modal = document.getElementById('playlist-modal');
          document.getElementById('playlist-modal-title').textContent = 'Nova Playlist';
          document.getElementById('playlist-create-body').classList.remove('hidden');
          document.getElementById('playlist-select-body').classList.add('hidden');
          const input = document.getElementById('input-playlist-name');
          input.value = '';
          modal.classList.remove('hidden');
          setTimeout(() => input.focus(), 50);
        },

        openAddToPlaylistModal(track) {
          if (!track) return;
          state.pendingTrackForPlaylist = Storage.sanitizeTrackMetadata(track);
          const modal = document.getElementById('playlist-modal');
          document.getElementById('playlist-modal-title').textContent = 'Adicionar à Playlist';
          document.getElementById('playlist-create-body').classList.add('hidden');
          document.getElementById('playlist-select-body').classList.remove('hidden');
          document.getElementById('playlist-target-track-label').textContent = `${track.title} — ${track.artist}`;

          const listEl = document.getElementById('playlist-select-list');
          if (state.playlists.length === 0) {
            listEl.innerHTML = `<p class="text-xs text-white/50 py-3 text-center">Você ainda não possui playlists.</p>`;
          } else {
            listEl.innerHTML = state.playlists.map(pl => {
              const alreadyIn = pl.tracks.some(t => t.trackId === track.trackId);
              return `<button data-target-pl="${pl.id}" class="w-full glass-chip px-3.5 py-2.5 rounded-2xl flex items-center justify-between text-xs text-white">
                <span class="font-medium truncate pr-2">${this.escapeHtml(pl.name)}</span>
                <span class="text-[11px] ${alreadyIn ? 'accent-text font-semibold' : 'text-white/50'}">
                  ${alreadyIn ? 'Adicionada ✓' : `${pl.tracks.length} faixas`}
                </span>
              </button>`;
            }).join('');

            listEl.querySelectorAll('button[data-target-pl]').forEach(btn => {
              btn.addEventListener('click', () => {
                const plId = btn.getAttribute('data-target-pl');
                const pl = state.playlists.find(p => p.id === plId);
                if (!pl) return;
                if (!pl.tracks.some(t => t.trackId === state.pendingTrackForPlaylist.trackId)) {
                  pl.tracks.push(state.pendingTrackForPlaylist);
                  Storage.savePlaylists();
                  this.renderSidebarPlaylists();
                  this.showToast(`Adicionada em "${pl.name}"`, 'success');
                } else {
                  this.showToast('Esta música já está na playlist.');
                }
                modal.classList.add('hidden');
              });
            });
          }

          modal.classList.remove('hidden');
        },

        // Controle do Player Expansível em Tela Cheia
        setFullscreenOpen(isOpen) {
          state.fullscreenOpen = isOpen;
          const fsEl = document.getElementById('mobile-fullscreen-player');
          fsEl.classList.toggle('closed', !isOpen);
          fsEl.classList.toggle('open', isOpen);
        },

        switchFullscreenTab(tab) {
          state.fullscreenTab = tab;
          const btnCover = document.getElementById('tab-fs-cover');
          const btnLyrics = document.getElementById('tab-fs-lyrics');
          const viewCover = document.getElementById('fs-view-cover');
          const viewLyrics = document.getElementById('fs-view-lyrics');

          if (tab === 'cover') {
            btnCover.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white/15 text-white transition';
            btnLyrics.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white transition';
            viewCover.classList.remove('hidden');
            viewLyrics.classList.add('hidden');
          } else {
            btnLyrics.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white/15 text-white transition';
            btnCover.className = 'px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white transition';
            viewLyrics.classList.remove('hidden');
            viewCover.classList.add('hidden');
          }
        }
      };

      /* ======================================================================
         8. INICIALIZAÇÃO DE EVENTOS & PWA (MANIFEST + SERVICE WORKER)
         ====================================================================== */
      function bindEvents() {
        // Navegação Sidebar Desktop
        document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
          btn.addEventListener('click', () => UI.switchView(btn.getAttribute('data-view')));
        });

        // Navegação Inferior Mobile
        document.querySelectorAll('.mobile-nav-item[data-view]').forEach(btn => {
          btn.addEventListener('click', () => UI.switchView(btn.getAttribute('data-view')));
        });

        // Busca Instantânea com Debounce
        const searchInput = document.getElementById('search-input');
        const clearBtn = document.getElementById('btn-clear-search');
        let searchTimer = null;

        searchInput.addEventListener('input', () => {
          const val = searchInput.value.trim();
          clearBtn.classList.toggle('hidden', val.length === 0);
          clearTimeout(searchTimer);

          searchTimer = setTimeout(() => {
            if (val.length >= 2) {
              state.activeChipQuery = '';
              state.activeDiscoveryCategory = null;
              UI.switchView('explore');
              UI.loadExploreTracks(val, `Resultados para "${val}"`);
            } else if (val.length === 0) {
              state.activeChipQuery = DISCOVERY_CHIPS[0].query;
              state.activeDiscoveryCategory = DISCOVERY_CHIPS[0].category;
              UI.switchView('explore');
              UI.loadExploreTracks(DISCOVERY_CHIPS[0].query, 'Em Alta Agora', DISCOVERY_CHIPS[0].category);
            }
          }, 420);
        });

        clearBtn.addEventListener('click', () => {
          searchInput.value = '';
          clearBtn.classList.add('hidden');
          state.activeChipQuery = DISCOVERY_CHIPS[0].query;
          state.activeDiscoveryCategory = DISCOVERY_CHIPS[0].category;
          UI.switchView('explore');
          UI.loadExploreTracks(DISCOVERY_CHIPS[0].query, 'Em Alta Agora', DISCOVERY_CHIPS[0].category);
        });

        // Controles de Reprodução Desktop
        document.getElementById('btn-desktop-play').addEventListener('click', () => AudioEngine.togglePlayPause());
        document.getElementById('btn-desktop-next').addEventListener('click', () => AudioEngine.nextTrack());
        document.getElementById('btn-desktop-prev').addEventListener('click', () => AudioEngine.prevTrack());
        const miniPlayerButton = document.getElementById('btn-desktop-mini-player');
        if (window.electronAPI?.toggleMiniPlayer && miniPlayerButton) {
          miniPlayerButton.classList.remove('hidden');
          miniPlayerButton.style.display = 'inline-flex';
          miniPlayerButton.addEventListener('click', () => UI.setMiniPlayer(true));
        }
        document.getElementById('btn-mini-expand')?.addEventListener('click', () => UI.setMiniPlayer(false));
        document.getElementById('btn-mini-prev')?.addEventListener('click', () => AudioEngine.prevTrack());
        document.getElementById('btn-mini-play')?.addEventListener('click', () => AudioEngine.togglePlayPause());
        document.getElementById('btn-mini-next')?.addEventListener('click', () => AudioEngine.nextTrack());
        document.getElementById('mini-player-progress')?.addEventListener('input', (event) => {
          AudioEngine.seekToPercent(parseFloat(event.target.value));
        });
        window.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && state.isMiniPlayer) {
            void UI.setMiniPlayer(false);
          }
        });
        document.getElementById('btn-desktop-fav').addEventListener('click', () => UI.toggleFavorite(state.currentTrack));
        document.getElementById('btn-desktop-add-pl').addEventListener('click', () => UI.openAddToPlaylistModal(state.currentTrack));
        document.getElementById('btn-desktop-queue')?.addEventListener('click', () => UI.toggleQueueDrawer());
        document.getElementById('btn-mobile-mini-queue')?.addEventListener('click', () => UI.toggleQueueDrawer());
        document.getElementById('btn-close-queue')?.addEventListener('click', () => UI.toggleQueueDrawer(false));
        document.getElementById('queue-backdrop')?.addEventListener('click', () => UI.toggleQueueDrawer(false));
        document.getElementById('btn-clear-queue')?.addEventListener('click', () => AudioEngine.clearQueue());
        document.querySelectorAll('[data-queue-tab]').forEach(tab => {
          tab.addEventListener('click', () => {
            state.queueTab = tab.dataset.queueTab;
            UI.renderQueueDrawer();
          });
        });
        document.getElementById('toggle-autoplay-radio')?.addEventListener('click', () => {
          state.autoPlayEnabled = !state.autoPlayEnabled;
          state.settings.autoPlayEnabled = state.autoPlayEnabled;
          Storage.saveSettings();
          UI.renderQueueDrawer();
          UI.showToast(
            state.autoPlayEnabled
              ? 'Reprodução Automática ativada'
              : 'Reprodução Automática desativada',
            'success'
          );
        });
        document.getElementById('btn-open-import-playlists')?.addEventListener('click', () => {
          UI.openImportPlaylistsModal();
        });
        document.getElementById('btn-close-import-playlists')?.addEventListener('click', () => {
          UI.closeImportPlaylistsModal();
        });
        document.getElementById('btn-create-playlist-from-import')?.addEventListener('click', () => {
          UI.closeImportPlaylistsModal();
          UI.openCreatePlaylistModal();
        });
        document.getElementById('btn-import-spotify-playlist')?.addEventListener('click', async () => {
          const input = document.getElementById('input-spotify-playlist-url');
          const url = input.value.trim();
          if (!url) {
            UI.showToast('Cole o link público da playlist', 'error');
            return;
          }
          const button = document.getElementById('btn-import-spotify-playlist');
          button.disabled = true;
          button.textContent = 'Importando...';
          try {
            const imported = await ApiService.importSpotifyPlaylist(url);
            const tracks = (imported.tracks || []).map((track, index) => ({
              trackId: track.trackId || `spotify-${index}-${track.title}-${track.artist}`,
              title: track.title,
              artist: track.artist,
              album: track.album || 'Spotify',
              durationSec: track.durationSec || 180,
              artworkMedium: track.artworkMedium || track.cover || 'https://placehold.co/600x600/10131c/64748b?text=Spotify',
              artworkLarge: track.artworkLarge || track.cover || 'https://placehold.co/1000x1000/10131c/64748b?text=Spotify',
              previewUrl: track.previewUrl || ''
            }));
            if (!tracks.length) throw new Error('Nenhuma faixa foi encontrada');
            const playlist = {
              id: `pl_import_${Date.now()}`,
              name: imported.name || 'Playlist do Spotify',
              cover: imported.cover || tracks[0].artworkMedium,
              source: 'spotify',
              tracks
            };
            state.playlists.unshift(playlist);
            Storage.savePlaylists();
            UI.renderSidebarPlaylists();
            UI.renderImportedPlaylists();
            UI.showToast(`"${playlist.name}" importada`, 'success');
            input.value = '';
          } catch (error) {
            UI.showToast(error.message, 'error');
          } finally {
            button.disabled = false;
            button.textContent = 'Importar';
          }
        });
        document.getElementById('input-import-playlist-file')?.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const isCsv = file.name.toLocaleLowerCase().endsWith('.csv');
            const tracks = isCsv ? UI.parseCsvText(text) : UI.parseTxtText(text);
            if (!tracks.length) throw new Error('Nenhuma música encontrada no arquivo');
            const playlist = {
              id: `pl_file_${Date.now()}`,
              name: file.name.replace(/\.(csv|txt)$/i, '') || 'Playlist importada',
              cover: tracks[0].artworkMedium,
              source: isCsv ? 'csv' : 'txt',
              tracks
            };
            state.playlists.unshift(playlist);
            Storage.savePlaylists();
            UI.renderSidebarPlaylists();
            UI.renderImportedPlaylists();
            UI.showToast(`"${playlist.name}" importada`, 'success');
            event.target.value = '';
          } catch (error) {
            UI.showToast(error.message, 'error');
          }
        });
        document.addEventListener('click', (event) => {
          if (!event.target.closest('#track-options-menu') && !event.target.closest('[data-action="menu"]')) {
            document.getElementById('track-options-menu')?.classList.add('hidden');
          }
        });

        document.getElementById('desktop-progress').addEventListener('input', (e) => {
          AudioEngine.seekToPercent(parseFloat(e.target.value));
        });

        const desktopVol = document.getElementById('desktop-volume');
        desktopVol.addEventListener('input', (e) => {
          audio.volume = parseFloat(e.target.value);
          audio.muted = audio.volume === 0;
          ThemeEngine.updateSliderFill(desktopVol);
        });

        document.getElementById('btn-desktop-mute').addEventListener('click', () => {
          audio.muted = !audio.muted;
          const iconEl = document.querySelector('#btn-desktop-mute svg, #btn-desktop-mute i');
          if (iconEl) {
            document.getElementById('btn-desktop-mute').innerHTML =
              `<i data-lucide="${audio.muted ? 'volume-x' : 'volume-2'}" class="w-4 h-4"></i>`;
            lucide.createIcons({ root: document.getElementById('btn-desktop-mute') });
          }
        });

        // Shuffle & Repeat (Desktop e Fullscreen sincronizados)
        const toggleShuffle = () => {
          state.shuffle = !state.shuffle;
          ['btn-desktop-shuffle', 'btn-fs-shuffle'].forEach(id => {
            document.getElementById(id).classList.toggle('accent-text', state.shuffle);
          });
          UI.showToast(state.shuffle ? 'Modo aleatório ativado' : 'Modo aleatório desativado');
        };

        const cycleRepeat = () => {
          const order = ['off', 'all', 'one'];
          state.repeatMode = order[(order.indexOf(state.repeatMode) + 1) % order.length];
          const iconName = state.repeatMode === 'one' ? 'repeat-1' : 'repeat';
          const isActive = state.repeatMode !== 'off';

          ['btn-desktop-repeat', 'btn-fs-repeat'].forEach(id => {
            const btn = document.getElementById(id);
            btn.classList.toggle('accent-text', isActive);
            btn.innerHTML = `<i data-lucide="${iconName}" class="${id.includes('fs') ? 'w-5 h-5' : 'w-4 h-4'}"></i>`;
            lucide.createIcons({ root: btn });
          });

          const labels = { off: 'Repetição desativada', all: 'Repetir fila', one: 'Repetir faixa atual' };
          UI.showToast(labels[state.repeatMode]);
        };

        document.getElementById('btn-desktop-shuffle').addEventListener('click', toggleShuffle);
        document.getElementById('btn-fs-shuffle').addEventListener('click', toggleShuffle);
        document.getElementById('btn-desktop-repeat').addEventListener('click', cycleRepeat);
        document.getElementById('btn-fs-repeat').addEventListener('click', cycleRepeat);

        // Gaveta de Letras Desktop
        const toggleDesktopLyrics = () => {
          state.desktopLyricsOpen = !state.desktopLyricsOpen;
          document.getElementById('desktop-lyrics-drawer').classList.toggle('hidden', !state.desktopLyricsOpen);
          document.getElementById('btn-desktop-lyrics').classList.toggle('active', state.desktopLyricsOpen);
        };
        document.getElementById('btn-desktop-lyrics').addEventListener('click', toggleDesktopLyrics);
        document.getElementById('btn-close-desktop-lyrics').addEventListener('click', toggleDesktopLyrics);

        // Controles Mobile Mini-Player & Tela Cheia Expansível
        document.getElementById('btn-mobile-mini-play').addEventListener('click', (e) => {
          e.stopPropagation();
          AudioEngine.togglePlayPause();
        });
        document.getElementById('btn-mobile-mini-next').addEventListener('click', (e) => {
          e.stopPropagation();
          AudioEngine.nextTrack();
        });
        document.getElementById('btn-mobile-mini-fav').addEventListener('click', (e) => {
          e.stopPropagation();
          UI.toggleFavorite(state.currentTrack);
        });

        document.getElementById('mobile-mini-expand-area').addEventListener('click', () => UI.setFullscreenOpen(true));
        document.getElementById('btn-desktop-expand').addEventListener('click', () => UI.setFullscreenOpen(true));
        document.getElementById('btn-close-fullscreen').addEventListener('click', () => UI.setFullscreenOpen(false));

        document.getElementById('tab-fs-cover').addEventListener('click', () => UI.switchFullscreenTab('cover'));
        document.getElementById('tab-fs-lyrics').addEventListener('click', () => UI.switchFullscreenTab('lyrics'));

        document.getElementById('btn-fs-play').addEventListener('click', () => AudioEngine.togglePlayPause());
        document.getElementById('btn-fs-next').addEventListener('click', () => AudioEngine.nextTrack());
        document.getElementById('btn-fs-prev').addEventListener('click', () => AudioEngine.prevTrack());
        document.getElementById('btn-fs-fav').addEventListener('click', () => UI.toggleFavorite(state.currentTrack));
        document.getElementById('btn-fs-add-playlist').addEventListener('click', () => UI.openAddToPlaylistModal(state.currentTrack));
        document.getElementById('fs-progress').addEventListener('input', (e) => {
          AudioEngine.seekToPercent(parseFloat(e.target.value));
        });

        // Motor de Personalização em Tempo Real (Modal Flutuante)
        const customizerModal = document.getElementById('customizer-modal');
        const openCustomizer = () => {
          document.getElementById('input-backend-url').value = state.settings.backendUrl;
          customizerModal.classList.remove('hidden');
        };
        const closeCustomizer = () => customizerModal.classList.add('hidden');

        document.getElementById('btn-open-customizer-top').addEventListener('click', openCustomizer);
        document.getElementById('btn-open-customizer-sidebar').addEventListener('click', openCustomizer);
        document.getElementById('btn-backend-pill-sidebar').addEventListener('click', openCustomizer);
        document.getElementById('btn-close-customizer').addEventListener('click', closeCustomizer);
        document.getElementById('btn-done-customizer').addEventListener('click', closeCustomizer);

        document.getElementById('input-accent-picker').addEventListener('input', (e) => {
          state.settings.accentMode = 'manual';
          state.settings.accentColor = e.target.value;
          Storage.saveSettings();
          ThemeEngine.applyAll();
          UI.renderAccentPresets();
        });

        document.getElementById('slider-glass-alpha').addEventListener('input', (e) => {
          state.settings.glassAlpha = parseInt(e.target.value, 10) / 100;
          Storage.saveSettings();
          ThemeEngine.applyAll();
        });

        document.getElementById('slider-glass-blur').addEventListener('input', (e) => {
          state.settings.glassBlur = parseInt(e.target.value, 10);
          Storage.saveSettings();
          ThemeEngine.applyAll();
        });

        document.getElementById('toggle-oled-mode').addEventListener('click', () => {
          state.settings.oledMode = !state.settings.oledMode;
          Storage.saveSettings();
          ThemeEngine.applyAll();
        });

        document.getElementById('btn-accent-auto')?.addEventListener('click', () => {
          state.settings.accentMode = 'auto';
          Storage.saveSettings();
          if (state.currentTrack?.artworkLarge) {
            ThemeEngine.extractDominantAccent(state.currentTrack.artworkLarge);
          }
          ThemeEngine.applyAll();
          UI.renderAccentPresets();
        });

        document.querySelectorAll('[data-atmosphere]').forEach(button => {
          button.addEventListener('click', () => {
            if (state.settings.oledMode) return;
            state.settings.atmosphereMode = button.dataset.atmosphere;
            Storage.saveSettings();
            ThemeEngine.applyAll();
            if (state.currentTrack?.artworkLarge) ThemeEngine.setAmbientArtwork(state.currentTrack.artworkLarge);
          });
        });

        document.getElementById('toggle-frequency-visualizer')?.addEventListener('click', () => {
          state.settings.frequencyVisualizer = !state.settings.frequencyVisualizer;
          Storage.saveSettings();
          ThemeEngine.applyAll();
          ThemeEngine.initAudioVisualizer();
        });

        document.getElementById('btn-test-backend').addEventListener('click', async () => {
          const url = document.getElementById('input-backend-url').value.trim() || DEFAULT_SETTINGS.backendUrl;
          state.settings.backendUrl = url;
          Storage.saveSettings();
          const ok = await ApiService.checkBackendHealth(url);
          UI.showToast(
            ok ? 'Servidor Node.js Proxy conectado!' : 'Servidor offline. Usando fallback iTunes HQ.',
            ok ? 'success' : 'info'
          );
        });

        document.getElementById('btn-reset-glass').addEventListener('click', () => {
          state.settings = { ...DEFAULT_SETTINGS };
          state.autoPlayEnabled = true;
          Storage.saveSettings();
          ThemeEngine.applyAll();
          UI.renderAccentPresets();
          ThemeEngine.initAudioVisualizer();
          UI.showToast('Estética do vidro restaurada para o padrão.');
        });

        // Eventos de Playlists
        document.getElementById('btn-new-playlist-sidebar').addEventListener('click', () => UI.openCreatePlaylistModal());
        document.getElementById('btn-new-playlist-mobile').addEventListener('click', () => UI.openCreatePlaylistModal());
        document.getElementById('btn-close-playlist-modal').addEventListener('click', () => document.getElementById('playlist-modal').classList.add('hidden'));
        document.getElementById('btn-cancel-create-pl').addEventListener('click', () => document.getElementById('playlist-modal').classList.add('hidden'));
        document.getElementById('btn-close-select-pl').addEventListener('click', () => document.getElementById('playlist-modal').classList.add('hidden'));

        document.getElementById('btn-quick-create-from-select').addEventListener('click', () => {
          UI.openCreatePlaylistModal();
        });

        const confirmCreatePlaylist = () => {
          const name = document.getElementById('input-playlist-name').value.trim();
          if (!name) {
            UI.showToast('Digite um nome para a playlist.', 'error');
            return;
          }
          const newPl = {
            id: `pl_${Date.now()}`,
            name,
            tracks: state.pendingTrackForPlaylist ? [state.pendingTrackForPlaylist] : []
          };
          state.playlists.unshift(newPl);
          state.pendingTrackForPlaylist = null;
          Storage.savePlaylists();
          UI.renderSidebarPlaylists();
          if (state.currentView === 'playlists') UI.renderMobilePlaylistsCards();
          document.getElementById('playlist-modal').classList.add('hidden');
          UI.showToast(`Playlist "${name}" criada!`, 'success');
        };

        document.getElementById('btn-confirm-create-pl').addEventListener('click', confirmCreatePlaylist);
        document.getElementById('input-playlist-name').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') confirmCreatePlaylist();
        });
      }

      function setupUpdateBanner() {
        const updater = window.electronUpdater || window.glassMusicUpdater;
        if (!updater) return;
        const banner = document.getElementById('update-banner');
        const title = document.getElementById('update-banner-title');
        const detail = document.getElementById('update-banner-detail');
        const progressWrap = document.getElementById('update-progress-wrap');
        const progressBar = document.getElementById('update-progress-bar');
        const restartButton = document.getElementById('btn-restart-update');
        if (!banner || !title || !detail || !progressWrap || !progressBar || !restartButton) return;

        restartButton.addEventListener('click', () => {
          restartButton.disabled = true;
          restartButton.textContent = 'Reiniciando...';
          updater.restartAndInstall();
        });

        const checkDetail = document.getElementById('update-check-detail');
        const checkButton = document.getElementById('btn-check-updates');
        checkButton?.addEventListener('click', () => {
          if (checkDetail) checkDetail.textContent = 'Verificando...';
          checkButton.disabled = true;
          checkButton.textContent = 'Verificando...';
          updater.checkForUpdates();
        });

        updater.onUpdateStatus((payload) => {
          if (!payload?.status) return;
          if (payload.status === 'checking') {
            banner.classList.remove('hidden');
            title.textContent = 'Verificando atualizações';
            detail.textContent = 'Consultando o GitHub Releases...';
            progressWrap.classList.add('hidden');
            restartButton.classList.add('hidden');
            if (checkDetail) checkDetail.textContent = 'Verificando atualizações...';
            if (checkButton) {
              checkButton.disabled = true;
              checkButton.textContent = 'Verificando...';
            }
          } else if (payload.status === 'download-progress') {
            const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
            banner.classList.remove('hidden');
            title.textContent = 'Baixando atualização';
            detail.textContent = `${percent.toFixed(0)}% concluído`;
            progressWrap.classList.remove('hidden');
            progressBar.style.width = `${percent}%`;
            restartButton.classList.add('hidden');
          } else if (payload.status === 'update-downloaded') {
            banner.classList.remove('hidden');
            title.textContent = 'Atualização pronta';
            detail.textContent = payload.version
              ? `Versão ${payload.version} instalada no cache`
              : 'A nova versão está pronta';
            progressWrap.classList.add('hidden');
            restartButton.classList.remove('hidden');
            lucide.createIcons({ root: banner });
            if (checkDetail) checkDetail.textContent = `Versão ${payload.version || ''} pronta`;
            if (checkButton) {
              checkButton.disabled = false;
              checkButton.textContent = 'Verificar atualizações';
            }
          } else if (payload.status === 'update-available') {
            banner.classList.remove('hidden');
            title.textContent = 'Atualização disponível';
            detail.textContent = payload.version ? `Baixando versão ${payload.version}...` : 'Baixando atualização...';
            progressWrap.classList.remove('hidden');
            progressBar.style.width = '0%';
            restartButton.classList.add('hidden');
            if (checkDetail) checkDetail.textContent = `Atualização ${payload.version || ''} disponível`;
          } else if (payload.status === 'update-not-available') {
            banner.classList.remove('hidden');
            title.textContent = 'Você já está atualizado';
            detail.textContent = payload.currentVersion
              ? `Versão atual: ${payload.currentVersion}`
              : 'Nenhuma atualização encontrada';
            progressWrap.classList.add('hidden');
            restartButton.classList.add('hidden');
            if (checkDetail) checkDetail.textContent = `Você já está na versão ${payload.currentVersion || ''}`;
            if (checkButton) {
              checkButton.disabled = false;
              checkButton.textContent = 'Verificar atualizações';
            }
            setTimeout(() => banner.classList.add('hidden'), 5000);
          } else if (payload.status === 'development') {
            banner.classList.remove('hidden');
            title.textContent = 'Modo desenvolvimento';
            detail.textContent = payload.message || 'Atualizações disponíveis na versão instalada';
            progressWrap.classList.add('hidden');
            restartButton.classList.add('hidden');
            if (checkDetail) checkDetail.textContent = 'Verificação disponível na versão instalada';
            if (checkButton) {
              checkButton.disabled = false;
              checkButton.textContent = 'Verificar atualizações';
            }
          } else if (payload.status === 'error') {
            banner.classList.remove('hidden');
            title.textContent = 'Falha ao atualizar';
            detail.textContent = payload.message || 'Não foi possível verificar a atualização';
            progressWrap.classList.add('hidden');
            restartButton.classList.add('hidden');
            if (checkDetail) checkDetail.textContent = 'Erro ao verificar atualizações';
            if (checkButton) {
              checkButton.disabled = false;
              checkButton.textContent = 'Verificar atualizações';
            }
          }
        });
      }

      async function setupAppVersion() {
        let version = window.glassMusicVersion?.get?.() || '';
        if (!version) {
          try {
            const response = await fetch('/api/version', { cache: 'no-store' });
            if (response.ok) version = (await response.json()).version || '';
          } catch (error) {
            console.warn('Não foi possível obter a versão do aplicativo:', error.message);
          }
        }
        if (!version) return;
        const label = `v${version.replace(/^v/i, '')}`;
        const sidebarVersion = document.getElementById('app-version-sidebar');
        const customizerVersion = document.getElementById('app-version-customizer');
        if (sidebarVersion) sidebarVersion.textContent = label;
        if (customizerVersion) customizerVersion.textContent = `Versão atual: ${label}`;
      }

      function setupPWA() {
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
          navigator.serviceWorker.register(new URL('./sw.js', document.baseURI))
            .catch((error) => console.warn('Falha ao registrar Service Worker:', error));
        }
        let deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (event) => {
          event.preventDefault();
          deferredPrompt = event;
          const installButton = document.getElementById('btn-install-pwa-desktop');
          if (!installButton) return;
          installButton.classList.remove('hidden');
          installButton.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            deferredPrompt = null;
            installButton.classList.add('hidden');
          }, { once: true });
        });
      }

      /* ======================================================================
         BOOTSTRAP DA APLICAÇÃO
         ====================================================================== */
function hideSplashScreen() {
  const splash = document.getElementById('app-splash');
  if (!splash || splash.classList.contains('app-splash--hidden')) return;
  splash.classList.add('app-splash--hidden');
  setTimeout(() => splash.remove(), 400);
}

document.addEventListener('DOMContentLoaded', () => {
        Storage.load();
  applyTheme(state.settings);
  ThemeEngine.applyAll();
        UI.renderAccentPresets();
        UI.renderGenreChips();
        UI.renderSidebarPlaylists();
        UI.updateFavoritesBadge();
        UI.updateQueueBadge();
        UI.updateTechnicalBadge();
        setupUpdateBanner();
        void setupAppVersion();

        AudioEngine.init();
        bindEvents();
        setupPWA();
        lucide.createIcons();

        // Verifica status do servidor Node.js proxy e carrega catálogo inicial
        ApiService.checkBackendHealth();
        UI.loadExploreTracks(
          DISCOVERY_CHIPS[0].query,
          'Em Alta Agora',
          DISCOVERY_CHIPS[0].category
        );
        requestAnimationFrame(hideSplashScreen);
});

setTimeout(hideSplashScreen, 3500);
