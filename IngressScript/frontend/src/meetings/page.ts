// The Meetings page.
import { $, audio } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { closeDrawers } from '../drawers';
import { btn, card } from '../home/widgets';
import { renderLibrary, updateNav } from '../library/library';
import { loadMeetings, meetingStats, mt } from './data';
import { renderMeetingDetail } from './detail';
import { savePosition } from '../player/audio';
import { renderTeachTray } from '../teach/tray';
import { api } from '../util/api';
import { el } from '../util/elements';
import { fmtDur, plural } from '../util/format';

export async function showMeetings(open = null) {
  if (state.view === 'day') savePosition();
  state.view = 'meetings';
  state.date = null;
  renderTeachTray();
  state.openToken++;
  audio.pause();
  mt.open = open;
  $('app').classList.add('is-home');
  $('title').textContent = 'Meetings';
  document.title = 'Meetings \u00b7 Recorder Playback';
  $('subtitle').textContent = '';
  closeDrawers(); renderLibrary(); updateNav();
  $('home').scrollTop = 0;
  $('home-inner').replaceChildren(el('div', 'note', 'Loading meetings\u2026'));
  await loadMeetingsPage();
}

export async function loadMeetingsPage() {
  clearTimeout(mt.timer);
  const open = mt.open;
  try {
    if (open) mt.detail = await api(`/api/meetings/${open}`);
    else await loadMeetings();
  } catch (e) {
    if (state.view !== 'meetings') return;
    if (e.status === 404) { mt.open = null; return loadMeetingsPage(); }
    $('home-inner').replaceChildren(el('div', 'error-box', `Couldn\u2019t load meetings: ${e.message}`)); return;
  }
  if (state.view !== 'meetings' || mt.open !== open) return;
  renderMeetings();
  if (open && ['queued', 'running'].includes(mt.detail.summary_state.status)) mt.timer = setTimeout(loadMeetingsPage, 2500);
}

function renderMeetings() {
  const inner = $('home-inner');
  if (mt.open) { renderMeetingDetail(inner); return; }
  const ms = state.meetings || [];
  $('subtitle').textContent = plural(ms.length, 'meeting');
  const frag = document.createDocumentFragment();
  const head = el('div');
  head.append(el('h2', 'hello', 'Meetings'),
    el('p', 'lead', 'Mark lines or whole segments of a day as part of a meeting (use the add-person button on a line, or \u201cAdd to meeting\u201d on a segment). Open a meeting for its summary and status.'));
  frag.append(head);
  if (!ms.length) {
    const c = card('cal', 'No meetings yet');
    c.append(el('p', null, 'Open a day, then use \u201cAdd to meeting\u2026\u201d on a segment or the add-person button beside a line.'));
    frag.append(c);
  }
  for (const m of ms) {
    const c = el('section', 'card mt-card');
    const top = el('div', 'mt-top');
    const h = el('h3', null, m.name); h.onclick = () => showMeetings(m.id);
    top.append(h);
    top.append(el('span', 'chip ' + (m.summary ? (m.summary.outdated ? 'pending' : 'new') : ''), m.summary ? (m.summary.outdated ? 'Summary outdated' : 'Summary ready') : 'No summary'));
    top.append(btn('Open', 'small', () => showMeetings(m.id)));
    c.append(top, meetingStats(m));
    if (m.people.length) {
      const who = el('div');
      m.people.slice(0, 6).forEach(p => who.append(el('span', 'ov-person', `${displayName(p.name)} \u00b7 ${fmtDur(p.seconds)}`)));
      c.append(who);
    }
    if (m.summary?.overview) c.append(el('div', 'mt-overview', m.summary.overview));
    frag.append(c);
  }
  inner.replaceChildren(frag);
}
