// Meetings: loading and which lines are marked.
import { state } from '../core/state';
import { api } from '../util/api';
import { el } from '../util/elements';
import { fmtDur, plural, shortDate } from '../util/format';

export async function loadMeetings() {
  if (!state.server) return;
  try { state.meetings = (await api('/api/meetings')).meetings; } catch { /* keep the old list */ }
}
export const marksOf = (date, start) => (state.meetings || []).filter(m => m.marks.some(([d, s]) => d === date && Math.abs(s - start) < 0.05));
export const hasMark = (m, it) => m.marks.some(([d, s]) => d === it.date && Math.abs(s - it.start) < 0.05);

export const mt = { open: null, timer: null, detail: null };

export function meetingStats(m) {
  const bits = [plural(m.lines, 'line')];
  if (m.span) bits.push(fmtDur(m.span));
  if (m.days.length) bits.push(m.days.length === 1 ? shortDate(m.days[0]) : `${shortDate(m.days[0])} \u2013 ${shortDate(m.days[m.days.length - 1])}`);
  if (m.missing) bits.push(`${m.missing} marked ${m.missing === 1 ? 'line is' : 'lines are'} gone`);
  const s = el('div', 'mt-stats');
  s.append(...bits.map(b => el('span', null, b)));
  return s;
}
