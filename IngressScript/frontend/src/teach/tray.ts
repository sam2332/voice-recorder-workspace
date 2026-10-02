// Lines waiting to teach a voice (per-day tray in localStorage).
import { $, ICONS } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName } from '../day/helpers';
import { btn } from '../home/widgets';
import { playSnip } from '../review/snippets';
import { openTeach } from './dialog';
import { el, svg } from '../util/elements';
import { fmt, plural } from '../util/format';
import { store } from '../util/store';

// Lines moved to someone in the editor collect in a tray (per day, kept in this browser). One dialog then
// 1) teaches each person's voice from the ticked lines, 2) offers other lines of the day that sound like them.
export const TEACH_MIN = 2;
export const teachKey = date => 'teach:' + date;
export const teachItems = (date = state.date) => date ? store.get(teachKey(date), []) : [];
export const sameLine = (a, b) => Math.abs(a.start - b.start) < 0.02 && a.text === b.text;

export function addToTeach(item) {
  const date = state.date;
  // A line edited again replaces its earlier entry (same start time)
  const items = teachItems(date).filter(x => Math.abs(x.start - item.start) >= 0.02);
  if (!item.person.startsWith('Unknown')) items.push(item);
  store.set(teachKey(date), items);
  renderTeachTray();
}

export function renderTeachTray() {
  const tray = $('teach-tray');
  const items = state.view === 'day' ? teachItems() : [];
  tray.classList.toggle('hidden', !items.length);
  if (!items.length) { tray.replaceChildren(); return; }
  const people = [...new Set(items.map(x => x.person))];
  const open = btn('Teach voices…', 'small primary', () => openTeach());
  open.type = 'button';
  const x = el('button', 'x', '×'); x.type = 'button';
  x.title = 'Forget these moved lines (nothing is taught)'; x.setAttribute('aria-label', x.title);
  x.onclick = () => { store.set(teachKey(state.date), []); renderTeachTray(); };
  tray.replaceChildren(el('span', null, `${plural(items.length, 'line')} moved to ${people.map(displayName).join(', ')}`), open, x);
}

// One row: [checkbox] [▶ time text] [note]
export function teachRow(seg, { checked, disabled, note, cls }: { checked?: boolean; disabled?: boolean; note?: string; cls?: string }) {
  const row: HTMLLabelElement & { cb?: HTMLInputElement; seg?: any } = el('label', 'tl-row' + (disabled ? ' off' : ''));
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = checked && !disabled; cb.disabled = disabled;
  const b = el('button', 'vr-snip'); b.type = 'button'; b.title = 'Play this line';
  b.append(svg(ICONS.play), el('span', 'tm', clockAt(seg.start) || fmt(seg.start)), el('span', 'tx', seg.text));
  b.onclick = e => { e.preventDefault(); playSnip(seg, b); };
  row.append(cb, b);
  if (note) row.append(el('span', cls || 'tl-why', note));
  row.cb = cb; row.seg = seg;
  return row;
}
