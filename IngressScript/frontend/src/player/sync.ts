// Keeping the transcript, progress bar and play button in step with the audio.
import { $, ICONS, audio } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, isReady } from '../day/helpers';
import { renderPending } from '../day/pending';
import { clock, fmt } from '../util/format';

export function findIdx(t) {
  // Binary search for the last segment starting at or before t
  const a = state.segments; let lo = 0, hi = a.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (a[mid].start <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 && t <= a[ans].end + 0.75 ? ans : -1;
}

export function syncActive(force?: boolean) {
  if (!isReady()) return;
  const idx = findIdx(audio.currentTime);
  if (idx === state.activeIdx && !force) return;
  document.querySelectorAll('.cue.active').forEach(n => n.classList.remove('active'));
  state.activeIdx = idx;
  updateNow();
  if (idx < 0) { updateJump(null); return; }
  const node = document.querySelector(`.cue[data-i="${idx}"]`);
  if (!node) return;
  node.classList.add('active');
  const following = $('follow').checked && Date.now() - state.userScrolledAt > 4000;
  if (following && !audio.paused) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  updateJump(node);
}

export function updateNow() {
  let text = '';
  if (isReady()) {
    const seg = state.segments[state.activeIdx];
    const c = clockAt(audio.currentTime);
    text = [c, seg && !audio.paused ? `${displayName(seg.speaker)} speaking` : ''].filter(Boolean).join(' · ');
  } else if (state.rawIdx >= 0) {
    const s = state.sources[state.rawIdx];
    text = `Raw recording ${state.rawIdx + 1}` + (s.recorded_at ? ` · ${clock(s.recorded_at, audio.currentTime)}` : '');
  }
  $('now').textContent = text;
}

export function updateJump(node = document.querySelector('.cue.active')) {
  const box = $('transcript').getBoundingClientRect();
  let off = false;
  if (node && !audio.paused && isReady()) { const r = node.getBoundingClientRect(); off = r.bottom < box.top || r.top > box.bottom; }
  $('jump').classList.toggle('hidden', !off);
}

export function updateProgress() {
  const dur = (isReady() ? state.duration : audio.duration) || 0, t = audio.currentTime || 0;
  const pct = dur ? Math.min(100, t / dur * 100) : 0;
  $('played').style.width = pct + '%';
  $('knob').style.left = pct + '%';
  $('time').textContent = `${fmt(t)} / ${fmt(dur)}`;
  $('timeline').setAttribute('aria-valuenow', String(Math.round(t)));
  $('timeline').setAttribute('aria-valuetext', fmt(t));
}

export function updatePlayIcon() {
  const playing = !audio.paused;
  $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('play-icon').innerHTML = playing ? ICONS.pause : ICONS.play;
  if (!isReady() && state.date) renderPending();
}
