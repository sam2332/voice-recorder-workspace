// The timeline under the player: drawing and scrubbing.
import { $, audio } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, isReady, sourcesTimed } from '../day/helpers';
import { seek } from './audio';
import { findIdx } from './sync';
import { el } from '../util/elements';
import { fmt } from '../util/format';

export function renderTimeline() {
  const dur = state.duration || 1;
  const frag = document.createDocumentFragment();
  if (isReady()) {
    for (const s of state.segments) {
      if (s.noise) continue;
      const d = el('div', 'seg');
      d.style.left = (s.start / dur * 100) + '%';
      d.style.width = Math.max(0.1, (s.end - s.start) / dur * 100) + '%';
      d.style.background = state.colors[s.speaker];
      frag.append(d);
    }
  }
  $('segs').replaceChildren(frag);
  const ticks = document.createDocumentFragment();
  if (isReady() && sourcesTimed()) {
    state.sources.slice(1).forEach(s => {
      const t = el('div', 'tick'); t.style.left = (s.start / dur * 100) + '%'; ticks.append(t);
    });
  }
  $('ticks').replaceChildren(ticks);
  $('timeline').setAttribute('aria-valuemax', String(Math.round(dur)));
}

// Timeline scrubbing with hover preview
const tl = $('timeline'), tip = $('tip');
const tlDur = () => (isReady() ? state.duration : audio.duration) || 0;
const tAt = x => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * tlDur(); };
let dragging = false;

export function init(): void {
  tl.addEventListener('pointerdown', e => { if (!tlDur()) return; dragging = true; tl.setPointerCapture(e.pointerId); seek(tAt(e.clientX)); });
  tl.addEventListener('pointermove', e => {
    if (!tlDur()) return;
    const t = tAt(e.clientX), r = tl.getBoundingClientRect();
    let label = fmt(t);
    if (isReady()) {
      const seg = state.segments[findIdx(t)], c = clockAt(t);
      label = [c || fmt(t), seg ? displayName(seg.speaker) : ''].filter(Boolean).join(' · ');
    }
    tip.textContent = label;
    tip.style.left = Math.max(50, Math.min(r.width - 50, e.clientX - r.left)) + 'px';
    tip.classList.remove('hidden');
    if (dragging) seek(t);
  });
  tl.addEventListener('pointerup', () => dragging = false);
  tl.addEventListener('pointerleave', () => { if (!dragging) tip.classList.add('hidden'); });
  tl.addEventListener('keydown', e => {
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); seek(audio.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)); }
  });
}
