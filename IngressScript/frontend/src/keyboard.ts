// Keyboard shortcuts.
import type { AnyEl } from './core/dom';
import { $, RATES, audio } from './core/dom';
import { state } from './core/state';
import { isReady } from './day/helpers';
import { closeDrawers } from './drawers';
import { stepDay } from './library/library';
import { seek, setRate, stepLine, togglePlay } from './player/audio';
import { editLines } from './transcript/edit';
import { toast } from './util/toast';

export function init(): void {
  document.addEventListener('keydown', e => {
    if ($('app').classList.contains('hidden') || document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as AnyEl).tagName) && (e.target as AnyEl).type !== 'checkbox' && (e.target as AnyEl).type !== 'range';
    if (typing) return;
    const k = e.key;
    if (k === 'Escape') closeDrawers();
    else if (k === ' ' || k === 'k' || k === 'K') { if (k === ' ' && (e.target as AnyEl).tagName === 'BUTTON') return; e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); stepDay(-1); }
    else if (k === 'ArrowRight' && e.shiftKey) { e.preventDefault(); stepDay(1); }
    else if (k === 'ArrowLeft') { e.preventDefault(); seek(audio.currentTime - 10); }
    else if (k === 'ArrowRight') { e.preventDefault(); seek(audio.currentTime + 10); }
    else if (k === 'j' || k === 'J') stepLine(-1);
    else if (k === 'l' || k === 'L') stepLine(1);
    else if (k === '[') setRate(RATES[Math.max(0, RATES.indexOf(audio.playbackRate) - 1)] ?? 1);
    else if (k === ']') setRate(RATES[Math.min(RATES.length - 1, RATES.indexOf(audio.playbackRate) + 1)] ?? 1);
    else if (k === '/' && isReady()) { e.preventDefault(); $('search').focus(); }
    else if (k === 'f' || k === 'F') { $('follow').checked = !$('follow').checked; $('follow').onchange(null); toast($('follow').checked ? 'Following audio' : 'Follow off'); }
    else if (k === '?') $('help-dlg').showModal();
    else if (k === 'Delete' || k === 'Backspace') {
      const cue = document.activeElement?.closest?.<HTMLElement>('.cue');
      if (cue && isReady()) {
        e.preventDefault();
        // Keep keyboard flow: focus moves to the next line
        const next = cue.closest('.cue-row')?.nextElementSibling?.querySelector<HTMLElement>('.cue')
          || cue.closest('.turn')?.nextElementSibling?.querySelector<HTMLElement>('.cue');
        const nextIdx = next ? +next.dataset.i : null;
        editLines('trash', [state.segments[+cue.dataset.i]]).then(() => {
          if (nextIdx !== null) document.querySelector<HTMLElement>(`.cue[data-i="${nextIdx - 1}"]`)?.focus();
        });
      }
    }
  });
}
