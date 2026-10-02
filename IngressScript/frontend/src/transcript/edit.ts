// Changing lines on the server: replace, trash/restore, save a clip.
import { PALETTE } from '../core/dom';
import { state } from '../core/state';
import { openDay } from '../day/open';
import { renderStats } from '../day/stats';
import { refreshLibrary } from '../library/library';
import { renderTimeline } from '../player/timeline';
import { renderSpeakers } from '../speakers/panel';
import { loadSummary } from '../summary/summary';
import { reindex } from './noise';
import { renderTranscript } from './render';
import { api } from '../util/api';
import { toast } from '../util/toast';

const plainLine = x => ({ start: x.start, end: x.end, speaker: x.speaker, text: x.text, ...(x.edited ? { edited: true } : {}) });

// Scissors: cut one line out of the original recording as an MP3 in <day>/clips/
export async function saveClip(s, btn) {
  btn.disabled = true;
  try {
    const r = await api(`/api/days/${state.date}/clip`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: s.start, end: s.end, text: s.text }),
    });
    toast(`Clip saved (${r.seconds}s): ${r.path}`);
  } catch (e) { toast(e.message); }
  btn.disabled = false;
}

// Swap `old` lines for `neu` lines (edit / speaker / split / join), instantly, saved, with Undo
export async function replaceLines(old, neu, msg) {
  const date = state.date;
  const oldC = old.map(plainLine), newC = neu.map(plainLine);
  const gone = new Set(old);
  state.segments = state.segments.filter(x => !gone.has(x)).concat(newC.map(x => ({ ...x }))).sort((a, b) => a.start - b.start);
  for (const x of newC) if (!state.colors[x.speaker]) state.colors[x.speaker] = PALETTE[Object.keys(state.colors).length % PALETTE.length];
  reindex();
  state.editing = null;
  renderSpeakers(); renderTranscript(); renderTimeline(); renderStats();
  const post = (from, to) => api(`/api/days/${date}/lines`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'replace', items: from.map(x => ({ start: x.start, text: x.text })), new: to }),
  });
  try { await post(oldC, newC); loadSummary(date); }
  catch (e) { toast(`Couldn't save that: ${e.message}`); if (state.date === date) openDay(date, { keepPosition: true }); return; }
  toast(msg, { action: 'Undo', onAction: async () => {
    try { await post(newC, oldC); } catch (e) { toast(e.message); return; }
    if (state.date === date) await openDay(date, { keepPosition: true });
    toast('Undone'); refreshLibrary();
  } });
  refreshLibrary();
}

// action: 'trash' | 'keep' (flagged as noise but real). Applied instantly, saved, undoable.
export async function editLines(action, segs) {
  if (!segs.length || !state.server) return;
  const date = state.date;
  const items = segs.map(s => ({ start: s.start, text: s.text }));
  if (action === 'trash') { const gone = new Set(segs); state.segments = state.segments.filter(s => !gone.has(s)); reindex(); }
  else segs.forEach(s => delete s.noise);
  renderSpeakers(); renderTranscript(); renderTimeline(); renderStats();
  const post = act => api(`/api/days/${date}/lines`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: act, items }),
  });
  try { await post(action); loadSummary(date); }
  catch (e) { toast(`Couldn't save that: ${e.message}`); if (state.date === date) openDay(date, { keepPosition: true }); return; }
  if (action === 'trash') {
    toast(segs.length > 1 ? `${segs.length} lines removed` : 'Line removed', {
      action: 'Undo',
      onAction: async () => {
        try { await post('restore'); } catch (e) { toast(e.message); return; }
        if (state.date === date) await openDay(date, { keepPosition: true });
        toast(segs.length > 1 ? 'Lines restored' : 'Line restored');
        refreshLibrary();
      },
    });
  } else toast('Kept as speech');
  refreshLibrary();
}
