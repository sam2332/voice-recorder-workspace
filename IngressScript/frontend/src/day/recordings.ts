// The list of recordings in the day details panel.
import { $, ICONS, audio } from '../core/dom';
import { state } from '../core/state';
import { isReady, srcIndexAt } from './helpers';
import { renderPending } from './pending';
import { closeDrawers } from '../drawers';
import { seek, setAudio, togglePlay } from '../player/audio';
import { el, svg } from '../util/elements';
import { clock, fmt } from '../util/format';
import { toast } from '../util/toast';

export function recordingList(raw) {
  const box = el('div');
  state.sources.forEach((s, i) => {
    const active = raw ? state.rawIdx === i : state.activeSrc === i;
    const b = el('button', 'rec' + (active ? ' active' : ''));
    b.dataset.src = String(i);
    const num = el('span', 'num');
    if (raw && active) num.append(svg(audio.paused ? ICONS.play : ICONS.pause)); else num.textContent = String(i + 1);
    const mid = el('span');
    mid.style.minWidth = '0';
    mid.append(el('div', 'when', clock(s.recorded_at) || `Recording ${i + 1}`), el('div', 'file', s.name));
    b.append(num, mid, el('span', 'len', s.duration ? fmt(s.duration) : ''));
    b.title = raw ? 'Play this recording' : 'Jump to this recording';
    b.onclick = () => {
      if (raw) playRaw(i);
      else if (typeof s.start === 'number') { seek(s.start + 0.01, true); closeDrawers(); }
    };
    box.append(b);
  });
  return box;
}
export function renderRecordings() {
  $('recordings').replaceChildren(recordingList(false));
}
export function updateActiveSource() {
  if (!isReady()) return;
  const i = srcIndexAt(audio.currentTime);
  if (i === state.activeSrc) return;
  state.activeSrc = i;
  document.querySelectorAll<HTMLElement>('#recordings .rec').forEach(b => b.classList.toggle('active', +b.dataset.src === i));
}
export function playRaw(i) {
  const s = state.sources[i];
  if (!s?.url) { toast('That recording file is no longer in the RECORD folder.'); return; }
  if (state.rawIdx === i && audio.src) { togglePlay(); return; }
  state.rawIdx = i;
  setAudio(s.url, { quiet: true });
  audio.play().catch(() => {});
  renderPending();
}
