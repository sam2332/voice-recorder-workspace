// The voice review dialog shown after a day is transcribed.
import type { AnyEl } from '../core/dom';
import { $ } from '../core/dom';
import { state } from '../core/state';
import { isReady } from '../day/helpers';
import { openDay } from '../day/open';
import { refreshLibrary } from '../library/library';
import { stopSnip } from './snippets';
import { voiceCard, voiceGroup } from './voice-card';
import { api } from '../util/api';
import { el } from '../util/elements';
import { plural, shortDate } from '../util/format';
import { toast } from '../util/toast';

export function renderVoiceReview() {
  stopSnip();
  const talk = {}, lines = {};
  for (const x of state.segments) {
    if (x.noise) continue;
    talk[x.speaker] = (talk[x.speaker] || 0) + Math.max(0, x.end - x.start);
    (lines[x.speaker] ||= []).push(x);
  }
  const voices = Object.keys(talk).map(spk => ({
    spk, talk: talk[spk], lines: lines[spk],
    match: Math.max(0, ...(state.data?.voices || []).filter(x => x.name === spk).map(x => x.match || 0)),
    named: (state.data?.voices || []).some(x => x.name === spk && x.named),
  }));
  const isSure = v => v.match > 0 || v.named || state.reviewNamed.has(v.spk) || state.reviewOk.has(v.spk);
  const unsure = voices.filter(v => !state.reviewDraft.has(v.spk) && !isSure(v)).sort((a, b) => b.talk - a.talk);
  const sure = voices.filter(v => !state.reviewDraft.has(v.spk) && isSure(v)).sort((a, b) => b.talk - a.talk);
  const frag = document.createDocumentFragment();
  if (state.reviewDraft.size) {
    const groups = new Map();
    for (const [spk, draft] of state.reviewDraft) {
      const key = `${draft.kind}:${draft.name}`;
      if (!groups.has(key)) groups.set(key, { ...draft, voices: [] });
      
      const v = voices.find(v => v.spk === spk) || { spk, talk: 0, lines: [], match: 0, named: false };
      groups.get(key).voices.push(v);
    }
    for (const group of groups.values()) {
      const destination = voices.find(v => v.spk === group.name && !state.reviewDraft.has(v.spk));
      if (destination && !group.voices.includes(destination)) group.voices.unshift(destination);
    }
    const cards = [...groups.values()].map(group => group.voices.length > 1
      ? voiceGroup(group) : voiceCard(group.voices[0]));
    frag.append(el('div', 'vr-sect', `Pending assignments · ${plural(state.reviewDraft.size, 'assignment')}`), ...cards);
  }
  if (unsure.length) frag.append(el('div', 'vr-sect', `Not sure who these are · ${unsure.length}`), ...unsure.map(v => voiceCard(v)));
  if (sure.length) frag.append(el('div', 'vr-sect', `Named or recognised · ${sure.length}`), ...sure.map(v => voiceCard(v)));
  if (!voices.length) frag.append(el('p', 'note', 'Nobody said anything on this day.'));
  $('voices-list').replaceChildren(frag);
  $('voices-title').textContent = `Who was talking on ${shortDate(state.date)}?`;
  $('voices-done').textContent = state.reviewDraft.size
    ? `Save ${plural(state.reviewDraft.size, 'assignment')} and finish`
    : unsure.length ? `Save and finish (${plural(unsure.length, 'voice')} left unnamed)` : 'Save and finish';
}

export function openVoiceReview() {
  if (!state.server || !isReady()) return;
  state.reviewSeen.add(state.date);
  state.reviewOk = new Set(); state.reviewNamed = new Set(); 
  
  // Only clear drafts if we don't have any, or if we're starting a fresh review.
  // To prevent the "swapping" feel, we should preserve existing drafts if the dialog is being reopened.
  if (!state.reviewDraft.size) state.reviewDraft = new Map();
  
  renderVoiceReview();
  if (!$('voices-dlg').open) $('voices-dlg').showModal();
}

export function init(): void {
  $('voices-dlg').addEventListener('close', stopSnip);
  $('voices-dlg').addEventListener('click', e => { if ((e.target as AnyEl).closest('.row .btn')) stopSnip(); });
  // Saved from the button itself, not the dialog's close event (which isn't reliable in every browser)
  $('voices-done').addEventListener('click', async e => {
    e.preventDefault();
    const date = state.date;
    if (!date) return;
    const button = $('voices-done');
    button.disabled = true;
    const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const saved = [];
    try {
      for (const [speaker, assignment] of state.reviewDraft) {
        let result;
        if (assignment.kind === 'person') result = await post(`/api/days/${date}/relabel`, { old: speaker, new: assignment.name });
        else if (assignment.kind === 'tv') result = await post(`/api/days/${date}/tv-voice`, { speaker, name: assignment.name });
        else result = await post(`/api/days/${date}/voice-noise`, { speaker, noise: true });
        saved.push({ speaker, assignment, result });
      }
      await post(`/api/days/${date}/voices/reviewed`, { reviewed: true });
      if (state.data) state.data.voices_reviewed = true;
      state.reviewDraft.clear();
      if (state.date === date) await openDay(date, { keepPosition: true });
      if ($('voices-dlg').open) $('voices-dlg').close();
      refreshLibrary();
      toast('Voice assignments saved');
    } catch (error) {
      let rollbackFailed = false;
      for (const item of saved.reverse()) {
        const { speaker, assignment, result } = item;
        try {
          if (assignment.kind === 'person') {
            await post(`/api/days/${date}/relabel`, { old: assignment.name, new: speaker, lines: result.changed, labels: result.labels });
          } else if (assignment.kind === 'tv') {
            if (result.shown?.length) await post(`/api/days/${date}/voice-noise`, { speaker: assignment.name, noise: true, lines: result.shown });
            await post(`/api/days/${date}/relabel`, { old: assignment.name, new: speaker, lines: result.changed, labels: result.labels });
          } else {
            await post(`/api/days/${date}/voice-noise`, { speaker, noise: false, lines: result.changed });
          }
        } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) {
        state.reviewDraft = new Map();
        if (state.date === date) await openDay(date, { keepPosition: true });
        toast(`Save failed and some changes could not be undone: ${error.message}`);
      } else toast(saved.length ? `Save failed; changes rolled back. ${error.message}` : error.message);
    } finally { button.disabled = false; }
  });
}
