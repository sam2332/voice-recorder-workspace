// The Teach voices dialog.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { displayName, isReady } from '../day/helpers';
import { stopSnip } from '../review/snippets';
import { TEACH_MIN, renderTeachTray, sameLine, teachItems, teachKey, teachRow } from './tray';
import { replaceLines } from '../transcript/edit';
import { api } from '../util/api';
import { el } from '../util/elements';
import { plural, shortDate } from '../util/format';
import { store } from '../util/store';
import { toast } from '../util/toast';

const teach = { stage: 'learn', groups: [] };

export function openTeach() {
  if (!state.server || !isReady()) return;
  const items = teachItems();
  const byPerson: Record<string, any[]> = {};
  for (const it of items) (byPerson[it.person] ||= []).push(it);
  teach.stage = 'learn';
  teach.groups = Object.entries(byPerson).map(([person, its]) => {
    const card = el('div', 'vr');
    const head = el('div', 'vr-head');
    const dot = el('span', 'dot'); dot.style.background = state.colors[person] || 'var(--muted)';
    head.append(dot, el('span', 'nm', displayName(person)), el('span', 'meta', plural(its.length, 'line') + ' moved to them'));
    card.append(head, el('div', 'vr-sect', 'Learn their voice from these lines'));
    const list = el('div', 'vr-snips');
    const rows = its.map(it => {
      const seg = state.segments.find(s => sameLine(s, it)) || it;
      const short = seg.end - seg.start < TEACH_MIN;
      const stillThem = seg.speaker === undefined || seg.speaker === person;
      const r = teachRow(seg, {
        checked: true, disabled: short || !stillThem,
        note: short ? 'too short to learn from' : !stillThem ? `now ${displayName(seg.speaker)}` : `${(seg.end - seg.start).toFixed(1)}s`,
      });
      list.append(r);
      return r;
    });
    card.append(list);
    return { person, rows, card, sugg: [] };
  });
  $('teach-title').textContent = `Teach voices · ${shortDate(state.date)}`;
  $('teach-intro').textContent = 'Ticked lines are added to each person’s voice profile, so new days recognise them. '
    + 'Next, you’ll see other lines from this day that sound like them.';
  $('teach-list').replaceChildren(...teach.groups.map(g => g.card));
  $('teach-go').textContent = 'Teach and find similar lines';
  $('teach-go').disabled = false;
  $('teach-dlg').showModal();
}

async function teachGo() {
  const go = $('teach-go');
  const date = state.date;
  if (teach.stage === 'learn') {
    go.disabled = true; go.textContent = 'Teaching… (first time loads the voice model)';
    const taught = [];   // for undo
    for (const g of teach.groups) {
      const lines = g.rows.filter(r => r.cb.checked).map(r => ({ start: r.seg.start, text: r.seg.text }));
      if (!lines.length) continue;
      try {
        const r = await api(`/api/days/${date}/voice-train`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person: g.person, lines }) });
        if (r.trained.length) taught.push({ person: g.person, lines: r.trained });
      } catch (e) { toast(e.message); go.disabled = false; go.textContent = 'Try again'; return; }
    }
    // Taught (or deliberately unticked) lines leave the tray
    store.set(teachKey(date), []);
    renderTeachTray();
    if (taught.length) toast(`Taught ${taught.map(t => `${displayName(t.person)} (${plural(t.lines.length, 'line')})`).join(', ')}`, { action: 'Undo', onAction: async () => {
      for (const t of taught) {
        try { await api(`/api/days/${date}/voice-train`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person: t.person, lines: t.lines, remove: true }) }); } catch (e) { toast(e.message); return; }
      }
      toast('Voice teaching undone');
    } });
    // Stage 2: lines elsewhere on the day that sound like each person
    teach.stage = 'similar';
    go.textContent = 'Looking for similar lines…';
    for (const g of teach.groups) {
      g.card.querySelectorAll('.vr-sect, .vr-snips').forEach(n => n.remove());
      g.card.append(el('div', 'vr-sect', `Other lines that sound like ${displayName(g.person)}`));
      const list = el('div', 'vr-snips'); list.append(el('div', 'note', 'Listening…'));
      g.card.append(list);
      let found = [];
      try {
        found = (await api(`/api/days/${date}/voice-similar`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person: g.person }) })).lines;
      } catch (e) { list.replaceChildren(el('div', 'note', e.message)); continue; }
      g.sugg = found.map(f => {
        const seg = state.segments.find(s => sameLine(s, f));
        return seg && teachRow(seg, { checked: f.strong, cls: 'tl-score',
          note: `${Math.round(f.score * 100)}% · now ${displayName(seg.speaker)}` });
      }).filter(Boolean);
      list.replaceChildren(...(g.sugg.length ? g.sugg : [el('div', 'note', 'No other lines on this day sound clearly like them.')]));
    }
    const n = teach.groups.reduce((a, g) => a + g.sugg.length, 0);
    $('teach-intro').textContent = n
      ? 'Play any line to check. Strong matches are ticked; ticked lines move to that person (this day only).'
      : 'Done. Nothing else on this day sounds clearly like them.';
    go.disabled = false;
    go.textContent = n ? 'Move ticked lines' : 'Close';
    return;
  }
  // Stage 2 → move ticked suggestions (a normal edit, with Undo)
  stopSnip();
  const old = [], neu = [];
  for (const g of teach.groups) for (const r of g.sugg) {
    if (r.cb.checked && !old.includes(r.seg)) { old.push(r.seg); neu.push({ ...r.seg, speaker: g.person, edited: true }); }
  }
  $('teach-dlg').close();
  if (old.length) replaceLines(old, neu, `Moved ${plural(old.length, 'line')}`);
}

export function init(): void {
  $('teach-go').addEventListener('click', teachGo);
  $('teach-dlg').addEventListener('close', stopSnip);
  $('teach-later').addEventListener('click', stopSnip);
}
