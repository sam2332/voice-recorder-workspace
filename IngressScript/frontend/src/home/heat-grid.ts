// The GitHub-style activity grid used on Home and People.
import { state } from '../core/state';
import { card } from './widgets';
import { go } from '../library/library';
import { el } from '../util/elements';
import { fmtDur, isoDay, plural, toDate } from '../util/format';

export function heatGrid(counts: Record<string, number>, { title, cls, onClick, levels = [1, 3, 6] }: {
  title?: (date: string, n: number) => string; cls?: (date: string) => string; onClick?: (date: string) => void; levels?: number[];
} = {}) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  // Run to the latest day too, in case the recorder's clock is ahead of this computer's
  const latest = Object.keys(counts).sort().pop();
  const today = latest && toDate(latest) > now ? toDate(latest) : now;
  const start = new Date(today); start.setDate(start.getDate() - 52 * 7 - today.getDay());  // a Sunday, ~1 year back
  const level = n => !n ? 0 : n <= levels[0] ? 1 : n <= levels[1] ? 2 : n <= levels[2] ? 3 : 4;
  const grid = el('div', 'heat');
  ['', 'Mon', '', 'Wed', '', 'Fri', ''].forEach((t, i) => { const w = el('span', 'wd', t); w.style.gridRow = String(i + 2); grid.append(w); });
  let lastMonth = -1, days = 0, total = 0, streak = 0, best = 0;
  for (let w = 0, d = new Date(start); d <= today || d.getDay() !== 0; w++) {
    for (let dow = 0; dow < 7; dow++, d.setDate(d.getDate() + 1)) {
      if (dow === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) {
        lastMonth = d.getMonth();
        const m = el('span', 'mon', d.toLocaleDateString(undefined, { month: 'short' }));
        m.style.gridColumn = `${w + 2} / span 3`;
        grid.append(m);
      }
      const key = isoDay(d), n = counts[key] || 0;
      const sq = el('button', `sq l${level(n)}` + (n ? ' has' : '') + (n && cls ? ' ' + cls(key) : '')
        + (key === isoDay(now) ? ' today' : '') + (d > today ? ' future' : ''));
      sq.style.gridColumn = String(w + 2); sq.style.gridRow = String(dow + 2);
      const when = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      sq.title = n ? `${when}: ${title(key, n)}` : `${when}: nothing`;
      sq.setAttribute('aria-label', sq.title);
      if (n && onClick) sq.onclick = () => onClick(key); else sq.tabIndex = -1;
      grid.append(sq);
      if (d <= today) { if (n) { days++; total += n; streak++; best = Math.max(best, streak); } else streak = 0; }
    }
  }
  const wrap = el('div', 'heat-wrap'); wrap.append(grid);
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });   // most recent weeks in view
  return { wrap, days, total, best };
}

export function heatLegend(extra?: Node | string) {
  const legend = el('span', 'legend'); legend.append('Less ');
  for (let i = 0; i <= 4; i++) legend.append(el('span', `sq l${i}`));
  legend.append(' More');
  if (extra) legend.append(el('span', 'newkey'), extra);
  return legend;
}

export function activityCard() {
  const byDate = Object.fromEntries(state.library.map(d => [d.date, d]));
  const counts = Object.fromEntries(state.library.map(d => [d.date, d.recordings || 0]));
  const c = card('cal', 'Recording activity');
  const g = heatGrid(counts, {
    title: (k, n) => `${plural(n, 'recording')}, ${fmtDur(byDate[k].duration)}` + (byDate[k].status === 'pending' ? ' (not transcribed yet)' : ''),
    cls: k => byDate[k]?.status === 'pending' ? 'new' : '',
    onClick: k => go(k),
  });
  c.append(el('p', null, g.days ? `${plural(g.total, 'recording')} on ${plural(g.days, 'day')} in the last year · longest run ${plural(g.best, 'day')} in a row` : 'Days you record on will light up here.'));
  c.append(g.wrap);
  const foot = el('div', 'heat-foot');
  foot.append(el('span', null, 'Click a day to open it'), heatLegend('not transcribed'));
  c.append(foot);
  return c;
}
