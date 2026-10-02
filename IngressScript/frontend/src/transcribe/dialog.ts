// The transcribe dialog: speaker count and per-recording levels; the blocked-queue mode.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { libItem } from '../day/helpers';
import { refreshLibrary } from '../library/library';
import { transcribe } from '../library/queue';
import { clipRow } from './clip-row';
import { levelsPayload } from './levels';
import { stopPreview } from './preview';
import { drawWave } from './wave';
import { api } from '../util/api';
import { el } from '../util/elements';
import { plural, shortDate } from '../util/format';
import { toast } from '../util/toast';

async function loadClips(date: string, only?: string[]) {
  const list = $('clips-list');
  list.replaceChildren(el('div', 'note', 'Finding the speech in the recordings\u2026'));
  let r;
  try { r = await api(`/api/days/${date}/clips`); }
  catch (e) { list.replaceChildren(el('div', 'error-box', `Couldn't read the recordings: ${e.message}`)); return []; }
  const clips = only ? r.clips.filter(c => only.includes(c.name)) : r.clips;
  const flagged = clips.filter(c => c.issues?.length).length;
  $('clips-summary').textContent = `${plural(clips.length, 'segment')}` + (flagged ? ` \u00b7 ${flagged} need${flagged === 1 ? 's' : ''} attention` : '');
  list.replaceChildren(...clips.map(c => clipRow(c, r.default_rustle)));
  requestAnimationFrame(() => clips.forEach(drawWave));
  $('auto-all').onclick = () => {
    const auto = clips.filter(c => c.auto);
    auto.forEach(c => c.autoAdjust(true));
    const hard = auto.filter(c => c.auto.problems.length);
    toast(hard.length ? `Adjusted ${plural(auto.length, 'segment')}; ${hard.length} still need${hard.length === 1 ? 's' : ''} a listen`
      : `Adjusted ${plural(auto.length, 'segment')}. Click a waveform to listen.`);
  };
  return clips;
}

// Every manual Transcribe / Re-transcribe opens this, showing all of the day's recordings at once
export async function askTranscribe(title, date = state.date) {
  const dlg = $('process-dlg');
  dlg.classList.remove('blocked');
  const isCurrent = date === state.date;
  const hint = (isCurrent ? state.data?.speaker_hint : null) || {};
  const n = isCurrent ? Object.keys(state.colors).filter(s => s !== 'Unknown').length : 2;
  $('process-title').textContent = `${title}: ${shortDate(date)}`;
  $('process-lead').textContent = 'Stretches of speech are found first, so long silences and steady noise are left out. Check each segment\u2019s levels, then start. Click a waveform to hear it with your settings.';
  const mode = hint.num_speakers ? 'exact' : hint.min_speakers ? 'min' : 'auto';
  document.querySelector<HTMLInputElement>(`input[name=count-mode][value=${mode}]`).checked = true;
  $('count-exact').value = String(hint.num_speakers || Math.max(n, 2));
  $('count-min').value = String(hint.min_speakers || Math.max(n + 1, 2));
  // Re-transcribing replaces hand edits: say so plainly before it happens
  const edited = isCurrent ? state.segments.filter(x => x.edited).length : (libItem(date)?.edited || 0);
  $('process-note').replaceChildren(edited
    ? el('div', 'error-box', `You've edited ${plural(edited, 'line')} on this day. Re-transcribing replaces the whole transcript, so those edits will be lost. (Removed lines stay removed, and names you've given people are kept.)`)
    : libItem(date)?.status === 'ready'
      ? 'Names you have given people are kept. Takes a few minutes for a long day.'
      : 'You can keep browsing while it runs.');
  $('process-actions').replaceChildren(
    Object.assign(el('button', 'btn', 'Cancel'), { value: 'cancel', formNoValidate: true }),
    Object.assign(el('button', 'btn primary', edited ? 'Replace my edits and start' : 'Start'), { value: 'ok' }));
  dlg.returnValue = '';
  let clips = [];
  dlg.onclose = async () => {
    stopPreview();
    if (dlg.returnValue !== 'ok') return;
    const m = document.querySelector<HTMLInputElement>('input[name=count-mode]:checked').value;
    const h = m === 'exact' ? { num_speakers: +$('count-exact').value }
      : m === 'min' ? { min_speakers: +$('count-min').value } : {};
    try { if (clips.length) await api('/api/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ levels: levelsPayload(clips), reviewed: true }) }); }
    catch (e) { toast(`Couldn't save the levels: ${e.message}`); return; }
    transcribe([date], h);
  };
  dlg.showModal();
  clips = await loadClips(date);
}

// A flagged recording stops the whole queue: this pops up on any page until it's dealt with
export async function showBlocked(b) {
  const dlg = $('process-dlg');
  state.blockedFor = b.date + '|' + b.clips.join(',');
  dlg.classList.add('blocked');
  $('process-title').textContent = `Check ${b.clips.length > 1 ? 'these segments' : 'this segment'} before transcribing continues`;
  $('process-lead').textContent = `${shortDate(b.date)}: something looks unusual, so transcription is paused for everything until you choose. Click the waveform to listen.`;
  $('process-note').textContent = '';
  const send = async (levels, action) => {
    try {
      if (levels) await api('/api/levels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ levels, reviewed: true }) });
      await api('/api/blocked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      state.blockedFor = null;
      stopPreview(); dlg.close();
      toast(action === 'skip' ? `Skipped ${shortDate(b.date)}` : 'Transcription resumed');
      refreshLibrary();
    } catch (e) { toast(e.message); }
  };
  let clips = [];
  const skip = Object.assign(el('button', 'btn', 'Skip this day'), { type: 'button', onclick: () => send(null, 'skip') });
  const asIs = Object.assign(el('button', 'btn', 'Use as is'), { type: 'button', onclick: () => send(Object.fromEntries(clips.map(c => [c.name, {}])), 'continue') });
  const go_ = Object.assign(el('button', 'btn primary', 'Continue with these levels'), { type: 'button', onclick: () => send(levelsPayload(clips), 'continue') });
  $('process-actions').replaceChildren(skip, asIs, go_);
  dlg.onclose = null;
  if (!dlg.open) dlg.showModal();
  clips = await loadClips(b.date, b.clips);
}
