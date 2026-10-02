// Overview page: filters and cards.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { card } from '../home/widgets';
import { go } from '../library/library';
import { loadOverview, ov, overviewRows } from './data';
import { renderOverviewTable } from './table';
import { api } from '../util/api';
import { el } from '../util/elements';
import { fmtDur, longDate, plural, shortDate } from '../util/format';
import { toast } from '../util/toast';

export function renderOverview() {
  const days = state.overview.days;
  const inner = $('home-inner');
  if (!ov.built) {
    // The filter bar is built once so typing in it isn't interrupted by the refreshes while days are being read
    ov.built = true;
    const head = el('div');
    head.append(el('h2', 'hello', 'Overview'),
      el('p', 'lead', 'Memories, interactions, to-dos and plans pulled out of your last 30 days, and who you saw each day. Search or filter the table; click a time to hear it.'));
    ov.status = el('div');
    ov.filters = el('div', 'ov-filters');
    const q = el('input'); q.type = 'search'; q.placeholder = 'Search everything…'; q.setAttribute('aria-label', 'Search the overview');
    q.oninput = () => { ov.q = q.value; renderOverviewTable(); };
    ov.tabs = el('div', 'ov-tabs'); ov.tabs.setAttribute('role', 'tablist');
    ov.personSel = el('select'); ov.personSel.setAttribute('aria-label', 'Person');
    ov.personSel.onchange = () => { ov.person = ov.personSel.value; renderOverviewTable(); };
    const done = el('label', 'ov-check'); const cb = el('input'); cb.type = 'checkbox';
    cb.onchange = () => { ov.hideDone = cb.checked; renderOverviewTable(); };
    done.append(cb, ' Hide finished to-dos');
    ov.filters.append(q, ov.personSel, done);
    ov.count = el('div', 'ov-count');
    ov.tableWrap = el('div', 'ov-tablewrap');
    ov.saw = el('div');
    inner.classList.add('ov-wide');
    inner.replaceChildren(head, ov.status, ov.tabs, ov.filters, ov.count, ov.tableWrap, ov.saw);
  }

  // Status: what the background extraction is doing
  const x = state.overview.extractor;
  const errs = Object.entries(x.errors);
  ov.status.replaceChildren();
  if (x.current || x.queued.length) {
    const cur = x.current;
    const box = card('spin', 'Reading your days…');
    box.append(el('p', null, `${cur ? `${shortDate(cur.date)}: ${cur.label}` : 'Waiting'}${x.queued.length ? ` · ${plural(x.queued.length, 'more day')} waiting` : ''}`));
    const bar = el('div', 'bar-mini'); const fill = el('i'); fill.style.width = `${Math.round((cur?.progress || 0) * 100)}%`; bar.append(fill);
    box.append(bar);
    ov.status.append(box);
  }
  if (errs.length) {
    const box = card('alert', `Couldn’t read ${plural(errs.length, 'day')}`);
    box.classList.add('attention');
    box.append(el('p', null, String(errs[0][1])));
    const act = el('div', 'actions'); const b = el('button', 'btn small', 'Try again');
    b.onclick = async () => {
      try { await api('/api/overview/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retry: true }) }); } catch (e) { toast(e.message); }
      loadOverview();
    };
    act.append(b); box.append(act); ov.status.append(box);
  }

  // The person filter keeps its choice while the list of people is refreshed
  const names = [...new Set(overviewRows().flatMap(r => r.people))].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  ov.personSel.replaceChildren();
  [['', 'Everyone'], ...names.map(n => [n, displayName(n)])].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; ov.personSel.append(o); });
  ov.personSel.value = names.includes(ov.person) ? ov.person : (ov.person = '');
  renderOverviewTable();

  // Who I saw each day
  const saw = el('div', 'card');
  saw.append(el('h3', null, 'Who I saw each day'));
  const list = el('div', 'person-days');
  for (const d of days) {
    const row = el('div', 'pday');
    const dl = el('button', 'pday-date', shortDate(d.date)); dl.title = `Open ${longDate(d.date)}`; dl.onclick = () => go(d.date);
    const recs = el('div', 'precs');
    if (!d.speakers.length) recs.append(el('span', 'muted', 'No one identified'));
    for (const p of d.speakers) {
      const b = el('button', 'prec');
      b.append(el('b', null, displayName(p.name)), el('span', null, ` ${fmtDur(p.seconds)}`));
      b.title = `Open ${shortDate(d.date)} where ${displayName(p.name)} first speaks`;
      b.onclick = () => go(d.date, p.first_line);
      recs.append(b);
    }
    row.append(dl, recs); list.append(row);
  }
  if (!days.length) list.append(el('p', 'muted', 'No transcribed days in this window yet.'));
  saw.append(list);
  ov.saw.replaceChildren(saw);
}
