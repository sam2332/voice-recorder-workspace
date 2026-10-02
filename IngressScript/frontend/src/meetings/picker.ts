// Adding lines to a meeting.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { hasMark, loadMeetings } from './data';
import { renderTranscript } from '../transcript/render';
import { jsonPost } from '../util/api';
import { el } from '../util/elements';
import { plural } from '../util/format';
import { toast } from '../util/toast';

export function openMeetingPicker(segs, what) {
  if (!segs.length) { toast('There are no lines to add'); return; }
  const items = segs.map(s => ({ date: state.date, start: s.start, text: s.text }));
  const dlg = $('meeting-dlg'), list = $('meeting-list'), name = $('meeting-new');
  $('meeting-title').textContent = `${what} \u00b7 ${plural(items.length, 'line')}`;
  name.value = '';
  const refresh = async () => {
    await loadMeetings(); draw();
    if (state.view === 'day' && !state.editing) renderTranscript();
  };
  const draw = () => {
    const ms = state.meetings || [];
    list.replaceChildren(...(ms.length ? ms.map(m => {
      const all = items.every(it => hasMark(m, it));
      const row = el('div', 'item');
      row.append(el('span', 'nm', m.name), el('span', 'muted', plural(m.lines, 'line')));
      const b = el('button', 'btn small' + (all ? '' : ' primary'), all ? 'Remove' : 'Add'); b.type = 'button';
      b.onclick = async () => {
        try { await jsonPost(`/api/meetings/${m.id}/items`, all ? { remove: items } : { add: items }); }
        catch (e) { toast(e.message); return; }
        toast(all ? `Removed from ${m.name}` : `Added to ${m.name}`);
        refresh();
      };
      row.append(b);
      return row;
    }) : [el('div', 'note', 'No meetings yet. Create the first one below.')]));
  };
  const create = async () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    try { await jsonPost('/api/meetings', { name: n, items }); } catch (e) { toast(e.message); return; }
    toast(`Created \u201c${n}\u201d`);
    name.value = '';
    refresh();
  };
  $('meeting-create').onclick = create;
  name.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); create(); } };
  draw();
  dlg.showModal();
  loadMeetings().then(draw);
}
