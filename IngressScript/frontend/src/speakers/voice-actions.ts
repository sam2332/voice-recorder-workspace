// Naming, hiding and TV-tagging a voice on one day.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { openDay } from '../day/open';
import { refreshLibrary } from '../library/library';
import { renderVoiceReview } from '../review/dialog';
import { loadSpeakers } from './panel';
import { api } from '../util/api';
import { plural } from '../util/format';
import { toast } from '../util/toast';

export function stageVoiceReview(spk, kind, name) {
  state.reviewDraft.set(spk, { kind, name });
  state.reviewNamed.add(spk);
  renderVoiceReview();
}

// Best voice-match guesses for a name on this day (from the transcript's per-voice candidates)
export function voiceSuggestions(spk) {
  const best: Record<string, number> = {};
  for (const v of state.data?.voices || []) {
    if (v.name !== spk) continue;
    for (const c of v.candidates || []) if (c.name !== spk) best[c.name] = Math.max(best[c.name] || 0, c.score);
  }
  return Object.entries(best).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
}

// A TV show or music: flag all of this voice's lines on this day as noise (hidden, not counted)
export async function hideVoice(spk) {
  const date = state.date;
  const post = body => api(`/api/days/${date}/voice-noise`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r;
  try { r = await post({ speaker: spk, noise: true }); } catch (e) { toast(e.message); return; }
  await openDay(date, { keepPosition: true });
  if ($('voices-dlg').open) { state.reviewNamed.add(spk); renderVoiceReview(); }
  toast(`${displayName(spk)} hidden as TV / music (${plural(r.changed.length, 'line')})`, { action: 'Undo', onAction: async () => {
    try { await post({ speaker: spk, noise: false, lines: r.changed }); } catch (e) { toast(e.message); return; }
    if (state.date === date) await openDay(date, { keepPosition: true });
    if ($('voices-dlg').open) { state.reviewNamed.delete(spk); renderVoiceReview(); }
    toast('Undone'); refreshLibrary();
  } });
  refreshLibrary();
}

// One line that is a TV show or music: flag just that line as noise
export async function hideLine(s) {
  const date = state.date;
  const lines = [{ start: s.start, text: s.text }];
  const post = noise => api(`/api/days/${date}/voice-noise`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speaker: s.speaker, noise, lines }) });
  try { await post(true); } catch (e) { toast(e.message); return; }
  state.editing = null;
  await openDay(date, { keepPosition: true });
  toast('Line hidden as TV / music', { action: 'Undo', onAction: async () => {
    try { await post(false); } catch (e) { toast(e.message); return; }
    if (state.date === date) await openDay(date, { keepPosition: true });
    toast('Undone'); refreshLibrary();
  } });
  refreshLibrary();
}

// This voice is a YouTuber / TV show: name it, learn it, hide its lines (and on new days automatically)
export async function tvVoice(spk, name) {
  const date = state.date;
  const json = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r;
  try { r = await json(`/api/days/${date}/tv-voice`, { speaker: spk, name }); } catch (e) { toast(e.message); return; }
  await openDay(date, { keepPosition: true });
  if ($('voices-dlg').open) { state.reviewNamed.add(name); renderVoiceReview(); }
  loadSpeakers();
  toast(`${displayName(spk)} is TV: ${name}${r.learned ? '. Recognised on new days too' : ''}`, { action: 'Undo', onAction: async () => {
    try {
      if (r.shown.length) await json(`/api/days/${date}/voice-noise`, { speaker: name, noise: true, lines: r.shown });
      await json(`/api/days/${date}/relabel`, { old: name, new: spk, lines: r.changed, labels: r.labels });
    } catch (e) { toast(e.message); return; }
    if (state.date === date) await openDay(date, { keepPosition: true });
    if ($('voices-dlg').open) { state.reviewNamed.delete(name); renderVoiceReview(); }
    loadSpeakers(); toast('Undone'); refreshLibrary();
  } });
  refreshLibrary();
}

export async function relabelVoice(from, to) {
  const date = state.date;
  const post = body => api(`/api/days/${date}/relabel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let r;
  try { r = await post({ old: from, new: to }); } catch (e) { toast(e.message); return; }
  await openDay(date, { keepPosition: true });
  if ($('voices-dlg').open) { state.reviewNamed.add(to); renderVoiceReview(); }
  loadSpeakers();
  toast(r.learned
    ? `${displayName(from)} is ${displayName(to)}. ${displayName(to)}'s voice will be recognised on new days`
    : `${displayName(from)} is ${displayName(to)} on this day`, { action: 'Undo', onAction: async () => {
    // Undo moves the lines and the voice sample back
    try { await post({ old: to, new: from, lines: r.changed, labels: r.labels }); } catch (e) { toast(e.message); return; }
    if (state.date === date) await openDay(date, { keepPosition: true });
    if ($('voices-dlg').open) { state.reviewNamed.delete(to); renderVoiceReview(); }
    toast('Undone'); refreshLibrary();
  } });
  refreshLibrary();
}
