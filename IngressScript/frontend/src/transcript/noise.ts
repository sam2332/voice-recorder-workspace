// Hidden noise lines control.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { plural } from '../util/format';

export function renderNoiseCtl(n) {
  $('noise-ctl').classList.toggle('hidden', !n);
  $('noise-toggle').textContent = state.showNoise ? `Hide likely noise (${n})` : `${plural(n, 'noise line')} hidden`;
  $('noise-toggle').title = 'Lines that are probably clothing rustle or other noise rather than speech';
  $('noise-trash').classList.toggle('hidden', !state.showNoise);
  $('noise-trash').textContent = `Trash all ${n}`;
}

export function reindex() { state.segments.forEach((s, i) => s.i = i); }
