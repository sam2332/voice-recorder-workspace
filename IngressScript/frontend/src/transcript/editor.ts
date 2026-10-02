// The line editor dialog: words, who said it, split, join.
import { audio } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { hideLine } from '../speakers/voice-actions';
import { addToTeach } from '../teach/tray';
import { replaceLines } from './edit';
import { renderTranscript } from './render';
import { el } from '../util/elements';
import { toast } from '../util/toast';

export function openEditor(s, row) {
  if (state.editing) renderTranscript();   // only one line open at a time
  row = document.querySelector(`.cue[data-i="${s.i}"]`)?.closest('.cue-row') || row;
  audio.pause();
  state.editing = s;
  const box = el('div', 'line-editor');
  const ta = el('textarea'); ta.value = s.text; ta.rows = Math.max(2, Math.ceil(s.text.length / 70));
  ta.setAttribute('aria-label', 'Line text');

  // Who said it: everyone seen today + everyone in the voice database + a new name
  const who = el('select'); who.title = 'Who said this line';
  const names = [...new Set([...Object.keys(state.colors), ...(state.allSpeakers || []), ...(state.tvNames || [])])].filter(Boolean);
  names.forEach(n => { const o = el('option', null, displayName(n)); o.value = n; who.append(o); });
  const nw = el('option', null, 'New person…'); nw.value = '__new__'; who.append(nw);
  const tv = el('option', null, 'TV / music: hide this line'); tv.value = '__hide__'; who.append(tv);
  who.value = s.speaker;
  const newName = el('input'); newName.placeholder = 'Name'; newName.classList.add('hidden');
  who.onchange = () => {
    if (who.value === '__hide__') { who.value = s.speaker; hideLine(s); return; }
    newName.classList.toggle('hidden', who.value !== '__new__'); if (who.value === '__new__') newName.focus();
  };
  const speaker = () => who.value === '__new__' ? newName.value.trim() : who.value;
  const tidy = t => t.replace(/\s+/g, ' ').trim();

  const idx = state.segments.indexOf(s);
  const next = state.segments[idx + 1];
  const close = () => { state.editing = null; renderTranscript(); };
  const save = () => {
    const text = tidy(ta.value), sp = speaker();
    if (!text) { toast('A line can’t be empty. Use the bin to remove it.'); return; }
    if (!sp) { toast('Type the new person’s name'); newName.focus(); return; }
    if (text === s.text && sp === s.speaker) { close(); return; }
    replaceLines([s], [{ ...s, text, speaker: sp, edited: true }],
      sp !== s.speaker && text === s.text ? `Moved to ${displayName(sp)}` : 'Line saved');
    if (sp !== s.speaker) addToTeach({ start: s.start, end: s.end, text, person: sp });
  };
  const split = () => {
    const text = ta.value, pos = ta.selectionStart;
    const left = tidy(text.slice(0, pos)), right = tidy(text.slice(pos));
    if (!left || !right) { toast('Put the cursor where the line should split, then press Split'); ta.focus(); return; }
    // Split the time in proportion to where the cursor is in the text
    const t = Math.round((s.start + (s.end - s.start) * pos / Math.max(text.length, 1)) * 100) / 100;
    const sp = speaker() || s.speaker;
    replaceLines([s], [{ start: s.start, end: t, speaker: sp, text: left, edited: true },
                       { start: t, end: s.end, speaker: sp, text: right, edited: true }], 'Line split in two');
  };
  const join = () => {
    if (!next) return;
    replaceLines([s, next], [{ start: s.start, end: Math.max(s.end, next.end), speaker: speaker() || s.speaker,
                               text: tidy(`${ta.value} ${next.text}`), edited: true }], 'Lines joined');
  };
  const b = (label: string, cls: string, fn: () => void, title?: string) => { const x = el('button', 'btn small ' + cls, label); x.type = 'button'; x.onclick = fn; if (title) x.title = title; return x; };
  const joinBtn = b('Join with next', '', join,
    next ? `Add the next line ("${next.text.slice(0, 40)}${next.text.length > 40 ? '…' : ''}") to this one` : 'This is the last line');
  joinBtn.disabled = !next;
  const bar = el('div', 'editor-bar');
  bar.append(who, newName,
    b('Split at cursor', '', split, 'Split this line into two where the text cursor is'), joinBtn,
    el('span', 'grow'), el('span', 'hint', 'Enter to save · Esc to cancel'),
    b('Cancel', '', close), b('Save', 'primary', save));
  box.append(ta, bar);
  row.replaceChildren(box);
  const keys = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  ta.onkeydown = keys; newName.onkeydown = keys;
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}
