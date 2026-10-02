// Overview page: the table.
import { displayName } from '../day/helpers';
import { go } from '../library/library';
import { KINDS, ov, overviewRows, taskKey } from './data';
import { el } from '../util/elements';
import { plural, shortDate } from '../util/format';
import { store } from '../util/store';

export function renderOverviewTable() {
  const done = store.get('ovDone', {});
  const words = ov.q.toLowerCase().split(/\s+/).filter(Boolean);
  const all = overviewRows();
  // Every filter but the tab, so each tab can show how many items it would hold
  const base = all.filter(r => {
    if (ov.person && !r.people.includes(ov.person)) return false;
    if (ov.hideDone && r.kind === 'task' && done[taskKey(r)]) return false;
    const hay = [r.text, KINDS[r.kind], r.date, shortDate(r.date), ...r.people.map(displayName)].join(' ').toLowerCase();
    return words.every(w => hay.includes(w));
  });
  const counts = {};
  base.forEach(r => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
  if (ov.kind && !counts[ov.kind] && !all.some(r => r.kind === ov.kind)) ov.kind = '';
  ov.tabs.replaceChildren();
  [['', 'All', base.length], ...Object.entries(KINDS).filter(([k]) => all.some(r => r.kind === k)).map(([k, l]) => [k, l, counts[k] || 0])]
    .forEach(([k, l, n]) => {
      const t = el('button', 'ov-tab' + (ov.kind === k ? ' active' : ''));
      t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(ov.kind === k));
      t.append(l, el('span', 'n', String(n)));
      t.onclick = () => { ov.kind = k; renderOverviewTable(); };
      ov.tabs.append(t);
    });
  const rows = ov.kind ? base.filter(r => r.kind === ov.kind) : base;
  ov.count.textContent = all.length ? (rows.length === all.length ? plural(all.length, 'item') : `${rows.length} of ${plural(all.length, 'item')}`) : '';
  if (!rows.length) {
    ov.tableWrap.replaceChildren(el('p', 'muted ov-empty', all.length ? 'Nothing matches that.' : 'Nothing extracted yet. It appears here as each day is read.'));
    return;
  }
  const grid = el('div', 'ov-grid');
  for (const r of rows.slice(0, 600)) {
    const tr = el('div', 'ov-card');
    const top = el('div', 'ov-card-top');
    if (r.kind === 'task') {
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!done[taskKey(r)]; cb.setAttribute('aria-label', 'Done');
      cb.onchange = () => {
        const d = store.get('ovDone', {});
        if (cb.checked) d[taskKey(r)] = 1; else delete d[taskKey(r)];
        store.set('ovDone', d);
        tr.classList.toggle('ov-done', cb.checked);
        if (ov.hideDone) renderOverviewTable();
      };
      top.append(cb);
      tr.classList.toggle('ov-done', cb.checked);
    }
    const db = el('button', 'pday-date', shortDate(r.date)); db.onclick = () => go(r.date);
    if (!ov.kind) top.append(el('span', `ov-kind k-${r.kind}`, KINDS[r.kind]));
    top.append(db);
    const text = el('div', 'ov-text', r.text);
    const who = el('div', 'ov-card-people');
    r.people.forEach(n => {
      const b = el('button', 'ov-person', displayName(n));
      b.onclick = () => { ov.person = n; ov.personSel.value = n; renderOverviewTable(); };
      who.append(b);
    });
    if (r.start !== undefined) { const b = el('button', 'prec', r.at); b.title = 'Hear this moment'; b.onclick = () => go(r.date, r.start); top.append(b); }
    tr.append(top, text, who);
    grid.append(tr);
  }
  ov.tableWrap.replaceChildren(grid);
  if (rows.length > 600) ov.tableWrap.append(el('p', 'muted ov-empty', 'Showing the newest 600. Search or filter to narrow it.'));
}
