// Speakers panel in the day details.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { rename } from '../rename';
import { whoPicker } from './who-picker';
import { openSplit } from '../split/render';
import { renderTranscript } from '../transcript/render';
import { api } from '../util/api';
import { el } from '../util/elements';
import { fmtDur } from '../util/format';
import { toast } from '../util/toast';

export function renderSpeakers() {
  const talk = {};
  let total = 0;
  for (const s of state.segments) { if (s.noise) continue; const d = Math.max(0, s.end - s.start); talk[s.speaker] = (talk[s.speaker] || 0) + d; total += d; }
  const list = Object.keys(talk).sort((a, b) => talk[b] - talk[a]);
  $('speakers').replaceChildren(...list.map(spk => {
    const wrap = el('div', 'speaker-row');
    const b = el('button', 'speaker' + (state.hidden.has(spk) ? ' off' : ''));
    b.title = `${displayName(spk)}: ${fmtDur(talk[spk])} talking. Click to hide/show, double-click to rename everywhere`;
    const dot = el('span', 'dot'); dot.style.background = state.colors[spk];
    const exact = total ? talk[spk] / total * 100 : 0;
    const pct = Math.round(exact);
    const bar = el('span', 'bar'); const fill = el('i');
    fill.style.width = (talk[spk] > 0 ? Math.max(exact, 2) : 0) + '%';   // a little talk still shows a sliver
    fill.style.background = state.colors[spk]; bar.append(fill);
    b.append(dot, el('span', 'name', displayName(spk)), el('span', 'pct', pct || talk[spk] <= 0 ? pct + '%' : '<1%'), el('span'), bar);
    let clickTimer;
    b.onclick = () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        state.hidden.has(spk) ? state.hidden.delete(spk) : state.hidden.add(spk);
        if (state.hidden.size === list.length) { state.hidden.clear(); toast('Showing all speakers'); }
        renderSpeakers(); renderTranscript();
      }, 220);
    };
    b.ondblclick = () => { clearTimeout(clickTimer); rename(spk); };
    wrap.append(b);
    if (state.server) {
      const p = whoPicker(spk);
      const sp = el('button', 'btn small split-btn', 'Split…'); sp.type = 'button';
      sp.title = 'This voice mixes several people: sort its lines between them';
      sp.onclick = () => openSplit(spk);
      p.append(sp);
      wrap.append(p);
    }
    return wrap;
  }));
}

export function loadSpeakers() {
  return api('/api/speakers').then(x => { state.allSpeakers = x.speakers; state.tvNames = x.tv || []; }).catch(() => {});
}
