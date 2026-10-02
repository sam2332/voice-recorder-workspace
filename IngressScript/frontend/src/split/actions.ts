// Splitting a mixed voice: sorting keys, suggestions and saving.
import type { AnyEl } from '../core/dom';
import { $ } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { playSnip, snipBtn, stopSnip } from '../review/snippets';
import { loadSpeakers } from '../speakers/panel';
import { renderSplit, renderSplitPeople } from './render';
import { SKIP, nextUnsorted, slotOf, split, splitNames } from './state';
import { sameLine } from '../teach/tray';
import { replaceLines } from '../transcript/edit';
import { api } from '../util/api';
import { el } from '../util/elements';
import { plural } from '../util/format';
import { toast } from '../util/toast';

export function playSplit() {
  const seg = split.order[split.i];
  if (!seg || !split.playBtn) return;
  if (snipBtn === split.playBtn) stopSnip();
  playSnip(seg, split.playBtn);
}

export function splitPick(p) {
  const seg = split.order[split.i];
  if (!seg || (p !== SKIP && !splitNames()[p])) return;
  split.hist.push({ seg, prev: split.pick.get(seg), i: split.i });
  split.pick.set(seg, p);
  const k = nextUnsorted(split.i + 1);
  split.i = k < 0 ? split.order.length : k;
  renderSplitPeople(); renderSplit(); playSplit();
}

export function splitBack() {
  const h = split.hist.pop(); if (!h) return;
  if (h.prev === undefined) split.pick.delete(h.seg); else split.pick.set(h.seg, h.prev);
  split.i = h.i;
  renderSplitPeople(); renderSplit(); playSplit();
}

export function splitAccept(entries) {
  for (const [seg, g] of entries) {
    const i = slotOf(g.person);
    if (i >= 0 && !split.pick.has(seg)) { split.hist.push({ seg, prev: undefined, i: split.i }); split.pick.set(seg, i); }
  }
  const k = nextUnsorted(split.i);
  split.i = k < 0 ? split.order.length : k;
  renderSplitPeople(); renderSplit(); playSplit();
}

export async function splitSuggest() {
  const names = splitNames();
  const seeds = {};
  for (const [seg, p] of split.pick) if (p !== SKIP && names[p]) (seeds[names[p]] ||= []).push({ start: seg.start, text: seg.text });
  const tools = $('split-tools');
  tools.append(el('span', 'muted', 'Listening… (the first time loads the voice model)'));
  let r;
  try {
    r = await api(`/api/days/${state.date}/voice-split`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: split.spk, seeds }) });
  } catch (e) { toast(e.message); renderSplit(); return; }
  split.sugg = new Map();
  for (const l of r.lines) { const seg = split.order.find(s => sameLine(s, l)); if (seg) split.sugg.set(seg, l); }
  toast(r.lines.length ? `${plural(r.lines.length, 'line')} sound like someone you named` : 'No other lines sound clearly like them yet. Sort a few more and try again.');
  renderSplit();
}

async function splitSave() {
  const names = splitNames();
  const old = [], neu = [], teachBy = {};
  for (const [seg, p] of split.pick) {
    if (p === SKIP || !names[p] || names[p] === seg.speaker) continue;
    old.push(seg); neu.push({ ...seg, speaker: names[p], edited: true });
    if (!names[p].startsWith('Unknown')) (teachBy[names[p]] ||= []).push({ start: seg.start, text: seg.text });
  }
  stopSnip();
  $('split-dlg').close();
  if (!old.length) return;
  const date = state.date;
  await replaceLines(old, neu, `Split ${displayName(split.spk)}: moved ${plural(old.length, 'line')}`);
  // Teach each person's profile from their sorted lines (the server skips short / overlapping ones)
  for (const [person, lines] of Object.entries(teachBy)) {
    try { await api(`/api/days/${date}/voice-train`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person, lines }) }); }
    catch (e) { toast(`Couldn't teach ${displayName(person)}: ${e.message}`); }
  }
  loadSpeakers();
}

export function init(): void {
  $('split-save').addEventListener('click', splitSave);
  $('split-cancel').addEventListener('click', stopSnip);
  $('split-dlg').addEventListener('close', stopSnip);
  $('split-dlg').addEventListener('keydown', e => {
    if ((e.target as AnyEl).matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (/^[1-4]$/.test(k) && split.slots[+k - 1] !== undefined) { e.preventDefault(); splitPick(+k - 1); }
    else if (k === 's') { e.preventDefault(); splitPick(SKIP); }
    else if (k === 'z') { e.preventDefault(); splitBack(); }
    else if (k === ' ') { e.preventDefault(); playSplit(); }
    else if (k === 'enter') {
      e.preventDefault();
      const g = split.sugg.get(split.order[split.i]);
      if (g && slotOf(g.person) >= 0) splitPick(slotOf(g.person));
    }
  });
}
