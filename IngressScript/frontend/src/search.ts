// Searching the transcript.
import type { AnyEl } from './core/dom';
import { $ } from './core/dom';
import { state } from './core/state';
import { renderTranscript } from './transcript/render';

function gotoMatch(dir) {
  if (!state.matches.length) return;
  state.matches[state.matchIdx]?.classList.remove('current');
  state.matchIdx = (state.matchIdx + dir + state.matches.length) % state.matches.length;
  const m = state.matches[state.matchIdx];
  m.classList.add('current');
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  state.userScrolledAt = Date.now();
  $('search-count').textContent = `${state.matchIdx + 1} of ${state.matches.length}`;
}

let searchTimer;

export function init(): void {
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderTranscript, 150); });
  $('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { (e.target as AnyEl).value = ''; renderTranscript(); (e.target as AnyEl).blur(); }
  });
}
