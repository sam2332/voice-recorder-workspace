// One voice's card in the voice review dialog.
import { ICONS } from '../core/dom';
import { state } from '../core/state';
import { clockAt, displayName, srcIndexAt } from '../day/helpers';
import { btn } from '../home/widgets';
import { renderVoiceReview } from './dialog';
import { SNIPS, playSnip, voiceSnippets } from './snippets';
import { stageVoiceReview, voiceSuggestions } from '../speakers/voice-actions';
import { whoPicker } from '../speakers/who-picker';
import { openSplit } from '../split/render';
import { el, svg } from '../util/elements';
import { clock, fmt, fmtDur, plural } from '../util/format';

export function voiceCard(v, member = false) {
  const draft = state.reviewDraft.get(v.spk);
  const sure = !!draft || v.match > 0 || v.named || state.reviewNamed.has(v.spk) || state.reviewOk.has(v.spk);
  const card = el(member || sure ? 'details' : 'div', member ? 'vr-member' : 'vr' + (sure ? '' : ' unsure'));
  const head = el('div', 'vr-head');
  const dot = el('span', 'dot'); dot.style.background = state.colors[v.spk];
  head.append(dot, el('span', 'nm', displayName(v.spk)), el('span', 'meta', `${fmtDur(v.talk)} talking · ${plural(v.lines.length, 'line')}`), el('span', 'grow'));
  const sugg = voiceSuggestions(v.spk);
  let status;
  if (draft) status = el('span', 'vr-status ok', draft.kind === 'hide' ? 'Pending · hidden' : `Pending · ${displayName(draft.name)}`);
  else if (state.reviewNamed.has(v.spk) || v.named) status = el('span', 'vr-status ok', 'Named by you');
  else if (state.reviewOk.has(v.spk)) status = el('span', 'vr-status ok', 'Confirmed');
  else if (v.match > 0) status = el('span', 'vr-status ok', `Recognised · ${Math.round(v.match * 100)}%`);
  else if (sugg[0]) status = el('span', 'vr-status', `Sounds like ${displayName(sugg[0].name)} · ${Math.round(sugg[0].score * 100)}%`);
  else status = el('span', 'vr-status', 'New voice');
  head.append(status);
  if (draft) {
    const undo = btn('Undo', 'small', e => {
      e.preventDefault(); e.stopPropagation();
      state.reviewDraft.delete(v.spk); state.reviewNamed.delete(v.spk); renderVoiceReview();
    });
    undo.type = 'button'; head.append(undo);
  }
  const confirmable = !draft && !v.named && !state.reviewOk.has(v.spk) && !state.reviewNamed.has(v.spk);
  if (confirmable && v.match > 0) {
    const ok = btn('Confirm', 'small', e => { e.preventDefault(); e.stopPropagation(); state.reviewOk.add(v.spk); renderVoiceReview(); });
    ok.type = 'button'; head.append(ok);
  } else if (confirmable && sugg[0]) {
    const ok = btn('Confirm', 'small', e => { e.preventDefault(); e.stopPropagation(); stageVoiceReview(v.spk, 'person', sugg[0].name); });
    ok.type = 'button'; ok.title = `Confirm this voice as ${displayName(sugg[0].name)}`;
    head.append(ok);
  }
  // Which recordings this voice is in (the start time of each recording)
  const recs = [...new Set<number>(v.lines.map(x => srcIndexAt(x.start)).filter(i => i >= 0))].sort((a, b) => a - b);
  const recText = recs.length
    ? `In ${plural(recs.length, 'recording')}: ` + recs.map(i => clock(state.sources[i].recorded_at) || state.sources[i].name || `#${i + 1}`).join(', ')
    : '';
  const top = sure || member ? el('summary') : el('div');
  top.append(head);
  if (recText) top.append(el('div', 'vr-recs', recText));
  card.append(top);

  const body = el('div', 'vr-body');
  const list = el('div', 'vr-snips');
  const all = voiceSnippets(v.spk);
  let shown = 0;
  const more = btn('More lines', 'small', () => addSnips());
  more.type = 'button';
  const addSnips = () => {
    for (const seg of all.slice(shown, shown + SNIPS)) {
      const b = el('button', 'vr-snip'); b.type = 'button';
      b.title = 'Play this line';
      b.append(svg(ICONS.play), el('span', 'tm', clockAt(seg.start) || fmt(seg.start)), el('span', 'tx', seg.text));
      b.onclick = () => playSnip(seg, b);
      list.insertBefore(b, more);
    }
    shown += SNIPS;
    more.classList.toggle('hidden', shown >= all.length);
  };
  list.append(more);
  if (!all.length) list.prepend(el('div', 'note', 'No clear lines to play (everything overlaps or is very short).'));
  const side = el('div');
  const sp = btn('Several people? Split…', 'small', () => openSplit(v.spk));
  sp.type = 'button'; sp.title = 'This voice mixes several people: sort its lines between them';
  side.append(el('div', 'vr-sect', 'Who is this?'), whoPicker(v.spk, true), sp);
  body.append(list, side);
  card.append(body);
  if (card.tagName === 'DETAILS') card.ontoggle = () => { if ((card as HTMLDetailsElement).open && !shown) addSnips(); };
  else addSnips();
  return card;
}

export function voiceGroup(group) {
  const card = el('details', 'vr vr-group');
  const summary = el('summary');
  const head = el('div', 'vr-head');
  const dot = el('span', 'dot'); dot.style.background = state.colors[group.name] || 'var(--accent)';
  const talk = group.voices.reduce((sum, v) => sum + v.talk, 0);
  head.append(dot, el('span', 'nm', group.kind === 'hide' ? 'Hidden as TV / music' : displayName(group.name)),
    el('span', 'meta', `${fmtDur(talk)} talking · ${plural(group.voices.length, 'voice')}`),
    el('span', 'grow'), el('span', 'vr-status ok', 'Pending · expand to review'));
  summary.append(head);
  card.append(summary, ...group.voices.map(v => {
    const member = voiceCard(v, true); (member as HTMLDetailsElement).open = true; return member;
  }));
  return card;
}
