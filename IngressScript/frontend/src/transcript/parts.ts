// Segments: stretches of speech between long silences.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, isReady } from '../day/helpers';
import { closeDrawers } from '../drawers';
import { openMeetingPicker } from '../meetings/picker';
import { seek } from '../player/audio';
import { el } from '../util/elements';
import { fmt, plural } from '../util/format';

export const partIndexAt = t => (state.data?.parts || []).findIndex(p => t >= p.start - 0.01 && t <= p.end + 0.01);
export const segmentLines = p => state.segments.filter(s => !s.noise && s.start >= p.start - 0.01 && s.start <= p.end + 0.01);

export function renderParts() {
  const parts = state.data?.parts || [];
  $('parts-section').classList.toggle('hidden', !(state.server && isReady() && parts.length));
  $('parts').replaceChildren(...parts.map((p, i) => {
    const row = el('div', 'part');
    const head = el('div', 'part-head');
    head.append(el('span', null, `Segment ${i + 1}`), el('span', 'part-meta', `${clockAt(p.start) || fmt(p.start)}\u2013${clockAt(p.end) || fmt(p.end)}`));
    row.append(head, el('div', 'part-meta', [plural(p.lines, 'line'), p.speakers.slice(0, 3).map(displayName).join(', ')].filter(Boolean).join(' \u00b7 ')));

    const act = el('div', 'part-actions');
    const jump = el('button', 'btn small', 'Play'); jump.type = 'button'; jump.onclick = () => { seek(p.start, true); closeDrawers(); };
    const mt = el('button', 'btn small', 'Add to meeting\u2026'); mt.type = 'button';
    mt.onclick = () => openMeetingPicker(segmentLines(p), `Segment ${i + 1}`);
    act.append(jump, mt);
    row.append(act);
    return row;
  }));
}
