// Opening a day: loading its transcript and audio.
import { $, PALETTE, audio } from '../core/dom';
import { state } from '../core/state';
import { isReady, libItem } from './helpers';
import { renderPending } from './pending';
import { renderRecordings } from './recordings';
import { renderBanner, renderStats } from './stats';
import { closeDrawers } from '../drawers';
import { showHome } from '../home/home';
import { renderLibrary, updateNav } from '../library/library';
import { loadMeetings } from '../meetings/data';
import { showMeetings } from '../meetings/page';
import { showOverview } from '../overview/data';
import { showPeople } from '../people/page';
import { savePosition, seek, setAudio } from '../player/audio';
import { updateNow, updateProgress } from '../player/sync';
import { renderTimeline } from '../player/timeline';
import { openVoiceReview } from '../review/dialog';
import { renderSpeakers } from '../speakers/panel';
import { loadSummary } from '../summary/summary';
import { renderTeachTray } from '../teach/tray';
import { renderParts } from '../transcript/parts';
import { renderTranscript } from '../transcript/render';
import { api } from '../util/api';
import { fromName, longDate, shortDate } from '../util/format';
import { toast } from '../util/toast';

// The app opens on Home; a day opens only when picked (or from a #YYYY-MM-DD link)
export function showApp() {
  $('empty').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderLibrary();
  const want = decodeURIComponent(location.hash.slice(1));
  if (want === 'people' && state.server) showPeople();
  else if (want === 'overview' && state.server) showOverview();
  else if (want === 'meetings' && state.server) showMeetings();
  else if (want && libItem(want)) openDay(want);
  else { history.replaceState(null, '', location.pathname); showHome(); }
}

export function normalizeSources(src) {
  return (src || []).map(s => typeof s === 'string'
    ? { name: s, start: null, duration: null, recorded_at: fromName(s), url: null }
    : { ...s, recorded_at: s.recorded_at || fromName(s.name) });
}

export async function openDay(date: string, opts: { keepPosition?: boolean } = {}) {
  if (!libItem(date)) return;
  state.view = 'day';
  $('app').classList.remove('is-home');
  const token = ++state.openToken;
  let data;
  try { data = await api(`/api/days/${encodeURIComponent(date)}`); }
  catch (e) { toast(`Couldn't load ${shortDate(date)}: ${e.message}`); return; }
  if (token !== state.openToken) return;  // the user already picked another day
  // Everyone the voice database knows, for the line editor's "who said it" picker
  api('/api/speakers').then(r => {
    state.allSpeakers = r.speakers; state.tvNames = r.tv || [];
    if (state.date === date && state.view === 'day') {
      renderSpeakers();   // fill the pickers' "Everyone" lists
      if (state.tvNames.length && !state.editing) renderTranscript();   // TV badges
    }
  }).catch(() => {});
  const keep = opts.keepPosition && date === state.date;
  if (!keep) savePosition();

  state.date = date;
  state.data = data;
  state.sources = normalizeSources(data.sources);
  state.segments = (data.segments || [])
    .filter(s => s && typeof s.start === 'number')
    .map((s, i) => ({ ...s, i, speaker: s.speaker || 'Unknown', text: String(s.text || '') }));
  state.renames = {};
  if (!keep) state.hidden = new Set();
  state.activeIdx = -1; state.activeSrc = -1;
  closeDrawers();

  state.colors = {};
  const order = libItem(date)?.speakers || [];
  [...new Set([...order, ...state.segments.map(s => s.speaker)])].forEach((s, i) => state.colors[s] = PALETTE[i % PALETTE.length]);

  $('title').textContent = longDate(date);
  document.title = `${shortDate(date)} · Recorder Playback`;
  renderLibrary(); updateNav(); renderTeachTray();

  const ready = isReady();
  $('toolbar').classList.toggle('hidden', !ready);
  $('transcript').classList.toggle('hidden', !ready);
  $('pending').classList.toggle('hidden', ready);
  $('export-btn').disabled = !ready;
  $('spk-section').classList.toggle('hidden', !ready);
  $('redo-section').classList.toggle('hidden', !ready);
  $('rec-section').classList.toggle('hidden', !ready || !state.sources.length || state.sources.some(s => s.file));

  if (ready) {
    if (!keep) $('search').value = '';
    state.duration = (keep && audio.duration) || (state.segments.length ? state.segments[state.segments.length - 1].end : 0);
    renderSpeakers();
    renderTranscript();
    renderBanner();
    if (!keep) setAudio(data.audio_url, { resume: true });
  } else {
    $('banner').classList.add('hidden');
    state.rawIdx = -1;
    setAudio(null, { quiet: true });
    state.duration = 0;
    renderPending();
    $('pending').scrollTop = 0;
  }
  renderRecordings();
  renderStats();
  renderParts();
  if (ready && state.server) loadMeetings().then(() => {
    if (state.date !== date || state.view !== 'day') return;
    if (!state.editing) renderTranscript();
    renderParts();
  });
  renderTimeline(); updateProgress(); updateNow();
  if (ready) { if (state.summary?.date !== date) $('summary-wrap').replaceChildren(); loadSummary(date); }
  if (ready && state.server && !keep && data.voices_reviewed === false && !state.reviewSeen.has(date)) openVoiceReview();
  else $('summary-wrap').replaceChildren();
  if (state.pendingSeek != null && isReady()) {
    const t = state.pendingSeek; state.pendingSeek = null;
    const jump = () => { seek(t); document.querySelector('.cue.active')?.scrollIntoView({ block: 'center' }); };
    audio.readyState >= 1 ? jump() : audio.addEventListener('loadedmetadata', jump, { once: true });
  }
}
