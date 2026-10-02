// Audio player controls.
import { $, audio } from '../core/dom';
import { state } from '../core/state';
import { clockAt, isReady } from '../day/helpers';
import { playRaw, updateActiveSource } from '../day/recordings';
import { renderStats } from '../day/stats';
import { syncActive, updatePlayIcon, updateProgress } from './sync';
import { renderTimeline } from './timeline';
import { fmt } from '../util/format';
import { store } from '../util/store';
import { toast } from '../util/toast';

// `src` is a File (picked locally) or a URL (server mode)
export function setAudio(src, { resume = false, quiet = false } = {}) {
  audio.pause();
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = null;
  audio.removeAttribute('src');
  audio.load();
  if (src) {
    if (typeof src === 'string') audio.src = src;
    else audio.src = state.audioUrl = URL.createObjectURL(src);
    const date = state.date;
    const pos = resume ? store.get('pos:' + date, 0) : 0;
    audio.addEventListener('loadedmetadata', () => {
      if (date !== state.date) return;
      if (pos > 1 && pos < audio.duration - 2) { audio.currentTime = pos; toast(`Resumed at ${clockAt(pos) || fmt(pos)}`); }
      state.duration = audio.duration || state.duration;
      renderStats(); renderTimeline(); updateProgress(); updateActiveSource();
    }, { once: true });
  } else if (!quiet) {
    if (state.server) toast('The audio file for this day is missing. Showing the transcript only.');
    else { $('audio-name').textContent = state.data.audio || `${state.date}_merged.wav`; $('audio-dlg').showModal(); }
  }
  updatePlayIcon();
}

function needAudio() {
  if (audio.src) return false;
  if (!isReady()) { if (state.sources.length) playRaw(0); return true; }
  if (state.server) { toast('No audio for this day.'); return true; }
  $('audio-name').textContent = state.data.audio || `${state.date}_merged.wav`;
  $('audio-dlg').showModal();
  return true;
}
export function togglePlay() { if (needAudio()) return; audio.paused ? audio.play() : audio.pause(); }
export function seek(t: number, play?: boolean) {
  if (needAudio()) return;
  audio.currentTime = Math.max(0, Math.min(t, (audio.duration || state.duration) - 0.1));
  state.userScrolledAt = 0;
  if (play) audio.play();
  updateProgress(); syncActive(true); updateActiveSource();
}
export function stepLine(dir) {
  if (!isReady()) return;
  const t = audio.currentTime;
  const visible = state.segments.filter(s => !state.hidden.has(s.speaker));
  const target = dir > 0 ? visible.find(s => s.start > t + 0.05) : [...visible].reverse().find(s => s.start < t - 1);
  if (target) seek(target.start, !audio.paused);
}
export function setRate(r) {
  audio.playbackRate = r;
  $('rate').textContent = (r % 1 ? r : r.toFixed(0)) + '×';
  store.set('rate', r);
}
export function savePosition() { if (state.date && audio.src && isReady()) store.set('pos:' + state.date, audio.currentTime); }
