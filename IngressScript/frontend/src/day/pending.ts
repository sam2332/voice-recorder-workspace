// The view for a day that is not transcribed yet.
import type { LibraryDay } from '../core/types';
import { $, ICONS } from '../core/dom';
import { state } from '../core/state';
import { libItem } from './helpers';
import { recordingList } from './recordings';
import { cancel } from '../library/queue';
import { askTranscribe } from '../transcribe/dialog';
import { el, svg } from '../util/elements';
import { clock, fmtDur, plural } from '../util/format';

export function renderPending() {
  const lib: Partial<LibraryDay> = libItem(state.date) || {};
  const job = lib.job;
  const status = job?.status || 'pending';
  const card = el('div', 'pending-card ' + status);
  const titles = { pending: 'Not transcribed yet', queued: 'Waiting in line', processing: 'Transcribing…', failed: 'Transcription failed' };
  card.append(svg(status === 'failed' ? ICONS.alert : status === 'processing' ? ICONS.spin : ICONS.clock, 'icon'), el('h2', null, titles[status]));

  const dur = state.sources.reduce((n, s) => n + (s.duration || 0), 0) || lib.duration;
  const bits = [plural(state.sources.length || lib.recordings || 0, 'recording'), fmtDur(dur)];
  if (lib.first_time) bits.push(lib.first_time === lib.last_time ? clock(lib.first_time) : `${clock(lib.first_time)} – ${clock(lib.last_time)}`);
  card.append(el('p', null, bits.join(' · ')));

  if (status === 'processing') {
    const p = el('div', 'progress');
    const bar = el('div', 'bar' + (job.progress ? '' : ' indeterminate')); const fill = el('i'); fill.style.width = `${job.progress * 100}%`; bar.append(fill);
    const lbl = el('div', 'lbl'); lbl.append(el('span', null, job.label + '…'), el('span', null, job.progress ? `${Math.round(job.progress * 100)}%` : ''));
    p.append(bar, lbl);
    card.append(p, el('p', 'note', 'You can keep browsing other days. This page updates when it finishes.'));
  } else if (status === 'queued') {
    card.append(el('p', 'note', `Position ${job.position} in the queue. Days are transcribed one at a time.`));
  } else if (status === 'failed') {
    card.append(el('div', 'error-box', job.error));
  }

  const actions = el('div', 'actions');
  if (status === 'pending' || status === 'failed') {
    const b = el('button', 'btn primary', status === 'failed' ? 'Try again' : 'Transcribe this day');
    b.onclick = () => askTranscribe(status === 'failed' ? 'Try again' : 'Transcribe');
    actions.append(b);
  } else if (status === 'queued') {
    const b = el('button', 'btn', 'Remove from queue');
    b.onclick = () => cancel(state.date);
    actions.append(b);
  }
  if (actions.children.length) card.append(actions);

  const inner = $('pending-inner');
  const frag = document.createDocumentFragment();
  frag.append(card);
  if (state.sources.length) {
    frag.append(el('h3', null, 'Listen to the raw recordings'));
    frag.append(recordingList(true));
  }
  inner.replaceChildren(frag);
}
