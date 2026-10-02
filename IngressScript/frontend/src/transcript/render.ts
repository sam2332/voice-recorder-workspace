// Drawing the transcript.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, sourcesTimed, srcIndexAt } from '../day/helpers';
import { marksOf } from '../meetings/data';
import { openMeetingPicker } from '../meetings/picker';
import { syncActive } from '../player/sync';
import { editLines, saveClip } from './edit';
import { openEditor } from './editor';
import { renderNoiseCtl } from './noise';
import { partIndexAt, segmentLines } from './parts';
import { el, svg } from '../util/elements';
import { clock, fmt, initials, plural } from '../util/format';

export function renderTranscript() {
  const inner = $('transcript-inner');
  const q = $('search').value.trim();
  const rx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null;
  const frag = document.createDocumentFragment();
  const timed = sourcesTimed() && state.sources.length > 1 && !state.sources.some(s => s.file);   // segments get their own dividers
  state.matches = [];
  let turn = null, lastSpk = null, lastEnd = -1, lastSrc = -1, shown = 0, lastPart = -1;

  const noiseCount = state.segments.filter(s => s.noise).length;
  const parts = state.data?.parts || [];
  for (const s of state.segments) {
    if (state.hidden.has(s.speaker) || (rx && !s.text.match(rx)) || (s.noise && !state.showNoise)) { lastSpk = null; continue; }
    shown++;
    // Mark where each segment (a stretch of speech between long silences) begins
    const pi = partIndexAt(s.start);
    if (state.server && parts.length > 1 && pi >= 0 && pi !== lastPart) {
      const p = parts[pi];
      const d = el('div', 'divider part-divider', `Segment ${pi + 1} of ${parts.length} · ${clockAt(p.start) || fmt(p.start)}–${clockAt(p.end) || fmt(p.end)} · ${plural(p.lines, 'line')}`);
      const add = el('button', 'btn small', 'Add to meeting…'); add.type = 'button';
      add.title = 'Mark every line of this segment as part of a meeting';
      add.onclick = () => openMeetingPicker(segmentLines(p), `Segment ${pi + 1}`);
      d.append(add);
      frag.append(d);
      lastSpk = null;
    }
    if (pi >= 0) lastPart = pi;
    // Mark where each separate recording begins
    const src = srcIndexAt(s.start);
    if (timed && src !== lastSrc && src >= 0) {
      const r = state.sources[src];
      frag.append(el('div', 'divider', `Recording ${src + 1} · ${clock(r.recorded_at) || fmt(r.start)}`));
      lastSpk = null;
    }
    lastSrc = src;
    // Start a new turn when the speaker changes or there's a long pause
    if (s.speaker !== lastSpk || s.start - lastEnd > 30) {
      turn = el('div', 'turn');
      const av = el('div', 'avatar', initials(displayName(s.speaker)));
      av.style.background = state.colors[s.speaker];
      const body = el('div');
      const head = el('div', 'turn-head');
      const when = el('span', 'when', clockAt(s.start) || fmt(s.start));
      when.title = `${fmt(s.start)} into the day`;
      const who = el('span', 'who', displayName(s.speaker));
      if ((state.tvNames || []).includes(s.speaker)) who.append(el('span', 'tv-badge', 'TV'));
      head.append(who, when);
      body.append(head);
      turn.append(av, body);
      frag.append(turn);
    }
    lastSpk = s.speaker; lastEnd = s.end;

    const cue = el('button', 'cue');
    cue.dataset.i = String(s.i);
    cue.title = `${clockAt(s.start) || fmt(s.start)}: click to play from here`;
    if (rx) {
      let pos = 0;
      for (const m of s.text.matchAll(rx)) {
        cue.append(document.createTextNode(s.text.slice(pos, m.index)));
        const mk = el('mark', null, m[0]);
        state.matches.push(mk);
        cue.append(mk);
        pos = m.index + m[0].length;
      }
      cue.append(document.createTextNode(s.text.slice(pos)));
    } else {
      cue.append(document.createTextNode(s.text));
    }
    const row = el('div', 'cue-row' + (s.noise ? ' noise' : ''));
    row.append(cue);
    if (s.noise) cue.append(el('span', 'noise-tag', 'likely noise'));
    if (s.edited) cue.append(el('span', 'edited-tag', 'edited'));
    const marked = marksOf(state.date, s.start);
    if (marked.length) cue.append(el('span', 'meeting-tag', marked.map(m => m.name).join(', ')));
    if (s.overlap?.length) {
      const ov = el('span', 'overlap-tag', `talking over: ${s.overlap.map(displayName).join(', ')}`);
      ov.title = `${s.overlap.map(displayName).join(' and ')} ${s.overlap.length > 1 ? 'were' : 'was'} also talking during this line, so some words may be missing or belong to them`;
      cue.append(ov);
    }
    if (state.server) {
      const pen = el('button', 'line-btn edit');
      pen.title = 'Edit this line'; pen.setAttribute('aria-label', 'Edit this line');
      pen.append(svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'));
      pen.onclick = () => openEditor(s, row);
      const cut = el('button', 'line-btn edit');
      cut.title = 'Save this line as an MP3 clip'; cut.setAttribute('aria-label', 'Save this line as an MP3 clip');
      cut.append(svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'));
      cut.onclick = () => saveClip(s, cut);
      const mt = el('button', 'line-btn mt' + (marked.length ? ' on' : ''));
      mt.title = marked.length ? `In meeting: ${marked.map(m => m.name).join(', ')}. Click to change` : 'Add this line to a meeting';
      mt.setAttribute('aria-label', 'Add this line to a meeting');
      mt.append(svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M18 8v6M15 11h6"/>'));
      mt.onclick = () => openMeetingPicker([s], 'This line');
      row.append(mt, cut, pen);
      if (s.noise) {
        const keep = el('button', 'line-btn keep');
        keep.title = 'Not noise: keep this line'; keep.setAttribute('aria-label', 'Keep this line');
        keep.append(svg('<path d="M20 6 9 17l-5-5"/>'));
        keep.onclick = () => editLines('keep', [s]);
        row.append(keep);
      }
      const del = el('button', 'line-btn');
      del.title = 'Remove this line (Del)'; del.setAttribute('aria-label', 'Remove this line');
      del.append(svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'));
      del.onclick = () => editLines('trash', [s]);
      row.append(del);
    }
    turn.lastChild.append(row);
  }
  renderNoiseCtl(noiseCount);

  if (!shown) {
    frag.append(el('div', 'no-results', state.segments.length
      ? (q ? `No lines match “${q}” on this day.` : noiseCount === state.segments.length ? 'Only noise was picked up on this day.' : 'All speakers are hidden.')
      : 'No speech was detected in these recordings.'));
  }
  inner.replaceChildren(frag);
  state.matchIdx = -1;
  $('search-count').textContent = q ? `${state.matches.length} match${state.matches.length === 1 ? '' : 'es'}` : '';
  state.activeIdx = -1;
  syncActive(true);
}
