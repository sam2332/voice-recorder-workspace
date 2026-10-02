// The "who is this voice" picker.
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { renderVoiceReview } from '../review/dialog';
import { hideVoice, relabelVoice, stageVoiceReview, tvVoice, voiceSuggestions } from './voice-actions';
import { el } from '../util/elements';

// "Who is this?" for one voice on this day: pick anyone the app knows, or a new name
export function whoPicker(spk, reviewMode = false) {
  const box = el('div', 'who-row');
  const sel = el('select'); sel.title = 'Who is this voice? (changes this day only)';
  sel.setAttribute('aria-label', `Who is ${displayName(spk)}?`);
  const names = [...new Set([spk, ...(state.allSpeakers || []), ...Object.keys(state.colors)])].filter(n => n && !n.startsWith('Unknown') || n === spk);
  const sugg = voiceSuggestions(spk);
  const self = el('option', null, `${displayName(spk)} (this voice)`); self.value = spk; sel.append(self);
  if (sugg.length) {
    // Closest known people by voice, most likely first
    const g = el('optgroup'); g.label = 'Suggested by voice';
    sugg.forEach(c => { const o = el('option', null, `${displayName(c.name)} · ${Math.round(c.score * 100)}% match`); o.value = c.name; g.append(o); });
    sel.append(g);
  }
  const everyone = el('optgroup'); everyone.label = 'Everyone';
  names.filter(n => n !== spk).forEach(n => { const o = el('option', null, displayName(n)); o.value = n; everyone.append(o); });
  sel.append(everyone);
  const nw = el('option', null, 'New person…'); nw.value = '__new__'; sel.append(nw);
  // TV / YouTube voices are learned like people, so new days hide them automatically
  const tvg = el('optgroup'); tvg.label = 'TV / YouTube (learned, kept, not a person)';
  (state.tvNames || []).forEach(n => { const o = el('option', null, `TV: ${n}`); o.value = 'tv:' + n; tvg.append(o); });
  const tvNew = el('option', null, 'New TV channel / show…'); tvNew.value = '__tvnew__'; tvg.append(tvNew);
  const hide = el('option', null, 'Just hide (don’t learn)'); hide.value = '__hide__'; tvg.append(hide);
  sel.append(tvg);
  const draft = reviewMode && state.reviewDraft.get(spk);
  if (draft) {
    const value = draft.kind === 'hide' ? '__hide__' : draft.kind === 'tv' ? 'tv:' + draft.name : draft.name;
    if (![...sel.options].some(o => o.value === value)) {
      const option = el('option', null, draft.kind === 'hide' ? 'Just hide (don’t learn)' : displayName(draft.name));
      option.value = value; sel.append(option);
    }
    sel.value = value;
  } else sel.value = spk;
  const input = el('input'); input.placeholder = 'Name, then Enter'; input.classList.add('hidden');
  let tvMode = false;
  const assign = (kind, name) => {
    if (reviewMode) stageVoiceReview(spk, kind, name);
    else if (kind === 'tv') tvVoice(spk, name);
    else if (kind === 'hide') hideVoice(spk);
    else relabelVoice(spk, name);
  };
  const apply = name => {
    name = (name || '').trim();
    if (!name || name === spk) {
      if (reviewMode && state.reviewDraft.has(spk)) {
        state.reviewDraft.delete(spk); state.reviewNamed.delete(spk); renderVoiceReview(); return;
      }
      sel.value = spk; input.classList.add('hidden'); sel.classList.remove('hidden'); return;
    }
    assign(tvMode ? 'tv' : 'person', name);
  };
  const restoreDraftSelection = () => {
    if (!reviewMode) return;
    const draft = state.reviewDraft.get(spk);
    if (!draft) { sel.value = spk; return; }
    const value = draft.kind === 'hide' ? '__hide__' : draft.kind === 'tv' ? 'tv:' + draft.name : draft.name;
    if ([...sel.options].some(o => o.value === value)) sel.value = value;
    else sel.value = spk;
  };
  sel.onchange = () => {
    if (sel.value === '__new__' || sel.value === '__tvnew__') {
      tvMode = sel.value === '__tvnew__';
      input.placeholder = tvMode ? 'Channel or show, then Enter' : 'Name, then Enter';
      sel.classList.add('hidden'); input.classList.remove('hidden'); input.focus();
    }
    else if (sel.value === '__hide__') { assign('hide', ''); }
    else if (sel.value.startsWith('tv:')) { const n = sel.value.slice(3); assign('tv', n); }
    else if (sel.value === spk) {
      if (reviewMode) {
        state.reviewDraft.delete(spk); state.reviewNamed.delete(spk); renderVoiceReview();
      }
    }
    else apply(sel.value);
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); apply(input.value); }
    if (e.key === 'Escape') { e.preventDefault(); restoreDraftSelection(); input.classList.add('hidden'); sel.classList.remove('hidden'); }
  };
  input.onblur = () => { if (!input.classList.contains('hidden')) apply(input.value || ''); };
  box.append(sel, input);
  // How the name was decided, and a one-click "maybe" when we have a good guess
  const v = (state.data?.voices || []).filter(x => x.name === spk);
  const match = Math.max(0, ...v.map(x => x.match || 0));
  if (match) box.append(el('div', 'who-note', `Recognised by voice · ${Math.round(match * 100)}% match`));
  else if (sugg[0]) {
    const maybe = el('button', 'btn small maybe', `Maybe ${displayName(sugg[0].name)}? ${Math.round(sugg[0].score * 100)}%`);
    maybe.type = 'button';
    maybe.title = `This voice sounds most like ${displayName(sugg[0].name)}. Click to use that name on this day.`;
    maybe.onclick = () => assign('person', sugg[0].name);
    box.append(maybe);
  }
  return box;
}
