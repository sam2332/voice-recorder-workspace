// Splitting a mixed voice: drawing the dialog.
import { $, ICONS } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, isReady } from '../day/helpers';
import { btn } from '../home/widgets';
import { stopSnip } from '../review/snippets';
import { playSplit, splitAccept, splitBack, splitPick, splitSuggest } from './actions';
import { SKIP, split, splitNames } from './state';
import { el, svg } from '../util/elements';
import { fmt, plural } from '../util/format';

export function openSplit(spk) {
  if (!state.server || !isReady()) return;
  if ($('voices-dlg').open) $('voices-dlg').close();
  stopSnip();
  Object.assign(split, { spk, slots: ['', '', ''], i: 0, pick: new Map(), hist: [], sugg: new Map() });
  split.order = state.segments.filter(s => s.speaker === spk && !s.noise).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  $('split-title').textContent = `Split ${displayName(spk)} · ${plural(split.order.length, 'line')}`;
  renderSplitPeople(); renderSplit();
  $('split-dlg').showModal();
  playSplit();
}

export function renderSplitPeople() {
  const box = $('split-people');
  const dl = el('datalist'); dl.id = 'split-names';
  [...new Set([...(state.allSpeakers || []), ...(state.tvNames || []), ...Object.keys(state.colors)])]
    .filter(n => n && n !== split.spk && !n.startsWith('Unknown')).sort((a, b) => a.localeCompare(b))
    .forEach(n => { const o = el('option'); o.value = n; dl.append(o); });
  box.replaceChildren(dl, ...split.slots.map((v, i) => {
    const row = el('div', 'split-slot');
    const inp = el('input'); inp.value = v; inp.setAttribute('list', 'split-names');
    inp.placeholder = i === 0 ? 'Person 1, e.g. Kenzie Meadows' : `Person ${i + 1}`;
    inp.oninput = () => { split.slots[i] = inp.value; renderSplit(); };
    inp.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); inp.blur(); } };
    const n = [...split.pick.values()].filter(p => p === i).length;
    row.append(el('kbd', null, String(i + 1)), inp, el('span', 'n', n ? plural(n, 'line') : ''));
    return row;
  }));
  if (split.slots.length < 4) {
    const add = btn('+ Another person', 'small', () => { split.slots.push(''); renderSplitPeople(); renderSplit(); });
    add.type = 'button'; box.append(add);
  }
}

export function renderSplit() {
  const card = $('split-card');
  const names = splitNames();
  const done = split.pick.size, total = split.order.length;
  const seg = split.order[split.i];
  card.replaceChildren();
  if (!seg || split.i < 0) {
    card.append(el('div', 'say', 'Every line is sorted.'), el('div', 'meta', 'Press Save to move them. You can still press Z to go back.'));
  } else {
    const picked = split.pick.get(seg);
    const sg = split.sugg.get(seg);
    card.append(el('div', 'meta', `${clockAt(seg.start) || fmt(seg.start)} · ${(seg.end - seg.start).toFixed(1)} s`
      + (picked !== undefined ? ` · sorted: ${picked === SKIP ? 'skipped' : displayName(names[picked] || '?')}` : '')
      + (seg.overlap?.length ? ` · talking over: ${seg.overlap.map(displayName).join(', ')}` : '')));
    card.append(el('div', 'say', seg.text));
    const keys = el('div', 'keys');
    const play = btn('', 'small', () => playSplit()); play.type = 'button';
    play.append(svg(ICONS.play), ' Replay'); split.playBtn = play; keys.append(play);
    names.forEach((n, i) => {
      const b = btn(`${i + 1} · ${n ? displayName(n) : `Person ${i + 1}`}`, 'small' + (sg && sg.person === n ? ' sugg' : ''), () => splitPick(i));
      b.type = 'button'; b.disabled = !n; keys.append(b);
    });
    const sk = btn('S · Skip', 'small', () => splitPick(SKIP)); sk.type = 'button'; keys.append(sk);
    const bk = btn('Z · Back', 'small', () => splitBack()); bk.type = 'button'; bk.disabled = !split.hist.length; keys.append(bk);
    card.append(keys);
    if (sg) card.append(el('div', 'meta', `Sounds like ${displayName(sg.person)} · ${Math.round(sg.score * 100)}%${sg.strong ? ' (strong)' : ''}. Enter to accept.`));
  }
  // Progress + suggestion tools
  const tools = $('split-tools');
  const bar = el('div', 'split-bar'); const fill = el('i'); fill.style.width = `${total ? done / total * 100 : 0}%`; bar.append(fill);
  const tagged = names.map((n, i) => n ? [...split.pick.values()].filter(p => p === i).length : 0);
  const ready = tagged.filter(n => n > 0).length >= 1 && names.filter(Boolean).length >= 1;
  const sug = btn('Suggest the rest by voice', 'small', () => splitSuggest()); sug.type = 'button';
  sug.disabled = !ready; sug.title = ready ? 'Score every unsorted line against the lines you sorted' : 'Sort a few lines per person first';
  const open = [...split.sugg.entries()].filter(([s]) => !split.pick.has(s));
  const strong = open.filter(([, g]) => g.strong);
  tools.replaceChildren(el('span', null, `${done} / ${total} sorted`), bar, sug);
  if (open.length) {
    const acc = btn(`Accept ${strong.length} strong`, 'small', () => splitAccept(strong)); acc.type = 'button'; acc.disabled = !strong.length;
    const all = btn(`Accept all ${open.length} suggestions`, 'small', () => splitAccept(open)); all.type = 'button';
    tools.append(acc, all);
  }
  $('split-save').disabled = ![...split.pick.values()].some(p => p !== SKIP);
}
