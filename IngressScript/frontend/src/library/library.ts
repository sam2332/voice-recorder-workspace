// The library sidebar, routing between pages, and polling the server.
import { $, PALETTE } from '../core/dom';
import { state } from '../core/state';
import { displayName, isReady, libItem } from '../day/helpers';
import { openDay, showApp } from '../day/open';
import { renderPending } from '../day/pending';
import { renderBanner } from '../day/stats';
import { closeDrawers } from '../drawers';
import { renderHome, showHome } from '../home/home';
import { refreshSync } from '../home/sync';
import { showMeetings } from '../meetings/page';
import { showOverview } from '../overview/data';
import { showPeople } from '../people/page';
import { showBlocked } from '../transcribe/dialog';
import { api } from '../util/api';
import { el } from '../util/elements';
import { clock, fmtDur, monthName, plural, shortDate } from '../util/format';
import { toast } from '../util/toast';

export function renderLibrary() {
  const list = $('lib-list');
  const scroll = $('library').scrollTop;
  const frag = document.createDocumentFragment();
  let month = null;
  for (const d of state.library) {
    const m = monthName(d.date);
    if (m !== month) { frag.append(el('div', 'month', m)); month = m; }
    const card = el('button', 'day-card' + (d.date === state.date ? ' active' : ''));
    card.dataset.date = d.date;
    const row = el('div', 'row');
    row.append(el('span', 'dname', shortDate(d.date)));
    const job = d.job;
    if (job?.status === 'processing') row.append(el('span', 'chip processing', `${Math.round((job.progress || 0) * 100)}%`));
    else if (job?.status === 'queued') row.append(el('span', 'chip queued', 'Queued'));
    else if (job?.status === 'failed') row.append(el('span', 'chip failed', 'Failed'));
    else if (job?.status === 'blocked') row.append(el('span', 'chip pending', 'Needs levels'));
    else if (d.status === 'pending') row.append(el('span', 'chip pending', 'Not transcribed'));
    else if (d.new_recordings) row.append(el('span', 'chip new', `+${d.new_recordings} new`));
    card.append(row);

    const bits = [fmtDur(d.duration)];
    if (d.parts) bits.push(plural(d.parts, 'segment'));
    else if (d.recordings) bits.push(plural(d.recordings, 'recording'));
    if (d.first_time) bits.push(d.first_time === d.last_time ? clock(d.first_time) : `${clock(d.first_time)}–${clock(d.last_time)}`);
    card.append(el('div', 'meta', job?.status === 'processing' ? job.label + '…' : bits.join(' · ')));

    if (job?.status === 'processing') {
      const bar = el('div', 'bar-mini'); const fill = el('i'); fill.style.width = `${(job.progress || 0) * 100}%`; bar.append(fill); card.append(bar);
    } else if (d.speakers?.length) {
      const people = el('div', 'people');
      const dots = el('span', 'dots');
      d.speakers.slice(0, 4).forEach((s, i) => { const dot = el('i'); dot.style.background = PALETTE[i % PALETTE.length]; dots.append(dot); });
      const names = d.speakers.slice(0, 3).map(displayName).join(', ') + (d.speakers.length > 3 ? ` +${d.speakers.length - 3}` : '');
      people.append(dots, el('span', null, names));
      card.append(people);
    }
    frag.append(card);
  }
  if (!state.library.length) frag.append(el('div', 'lib-empty', 'No recordings yet.'));
  list.replaceChildren(frag);
  $('library').scrollTop = scroll;

  const ready = state.library.filter(d => d.status === 'ready').length;
  $('lib-count').textContent = state.library.length ? `${ready}/${state.library.length} transcribed` : '';
  const todo = state.library.filter(d => d.status === 'pending' && !d.job);
  $('lib-actions').classList.toggle('hidden', todo.length < 2);
  $('process-all').textContent = `Transcribe all ${todo.length} days`;
}

// Header indicator: what's being transcribed right now, visible from any day
function renderJobPill() {
  const pill = $('job-pill'), j = state.jobs || {};
  const cur = j.current, waiting = (j.queued || []).length;
  if (j.blocked) {
    pill.classList.remove('hidden'); pill.classList.add('indeterminate');
    $('job-text').textContent = `Paused · ${shortDate(j.blocked.date)} needs your levels`;
    pill.title = 'A recording looks unusual: click to check it';
    pill.dataset.date = ''; pill.onclick = () => showBlocked(j.blocked);
    return;
  }
  pill.onclick = () => { const d = pill.dataset.date; if (d) { go(d); closeDrawers(); } };
  pill.classList.toggle('hidden', !cur && !waiting);
  if (!cur && !waiting) return;
  const pct = cur?.progress || 0;
  pill.classList.toggle('indeterminate', !cur || !pct);
  $('job-ring').setAttribute('stroke-dashoffset', String(50.27 * (1 - (cur && pct ? pct : 0.25))));
  $('job-text').textContent = cur
    ? `Transcribing ${shortDate(cur.date)} · ${pct ? Math.round(pct * 100) + '%' : cur.label}` + (waiting ? ` · ${waiting} waiting` : '')
    : `${plural(waiting, 'day')} waiting`;
  pill.title = cur ? `${cur.label}… (click to open ${shortDate(cur.date)})` : 'Waiting to start';
  pill.dataset.date = cur?.date || j.queued[0];
}

export function updateNav() {
  $('lib-home').classList.toggle('active', state.view === 'home');
  $('lib-people').classList.toggle('active', state.view === 'people');
  $('lib-overview').classList.toggle('active', state.view === 'overview');
  $('lib-meetings').classList.toggle('active', state.view === 'meetings');
  $('home-inner').classList.toggle('ov-wide', state.view === 'overview');
  const i = state.library.findIndex(d => d.date === state.date);
  // Library is newest first, so "previous" (older) is further down the list
  $('prev-day').disabled = i < 0 || i >= state.library.length - 1;
  $('next-day').disabled = i <= 0;
}
export function stepDay(dir) {
  const i = state.library.findIndex(d => d.date === state.date);
  const target = state.library[i + (dir < 0 ? 1 : -1)];
  if (target) go(target.date);
}
export function go(date: string, seekTo?: number) {
  if (!date) { if (location.hash) history.pushState(null, '', location.pathname); showHome(); return; }
  if (seekTo !== undefined) state.pendingSeek = seekTo;   // jump to this moment once the day is open
  if (date === 'people') { if (location.hash !== '#people') location.hash = 'people'; else showPeople(); return; }
  if (date === 'overview') { if (location.hash !== '#overview') location.hash = 'overview'; else showOverview(); return; }
  if (date === 'meetings') { if (location.hash !== '#meetings') location.hash = 'meetings'; else showMeetings(); return; }
  if (location.hash.slice(1) !== date) location.hash = date;  // hashchange opens it
  else openDay(date);
}

export async function refreshLibrary(quiet = true) {
  if (!state.server) return;
  let r;
  try { r = await api('/api/library'); }
  catch (e) { if (!quiet) toast(`Couldn't reach the server: ${e.message}`); schedulePoll(15000); return; }
  const prev = Object.fromEntries(state.library.map(d => [d.date, d]));
  state.library = r.days;
  state.recordDir = r.record_dir;
  state.jobs = r.jobs;
  renderJobPill();
  // A flagged recording has paused the queue: ask about it now, whatever page is open
  const b = r.jobs?.blocked;
  if (b && state.blockedFor !== b.date + '|' + b.clips.join(',')) showBlocked(b);
  if (!b && state.blockedFor && $('process-dlg').classList.contains('blocked')) { state.blockedFor = null; $('process-dlg').close(); }

  if ($('app').classList.contains('hidden')) { showApp(); schedulePoll(r.busy ? 2500 : 5000); return; }

  renderLibrary(); updateNav();
  for (const d of state.library) {
    const was = prev[d.date];
    const finished = d.status === 'ready' && !d.job && (was?.status === 'pending' || (was?.job && was.job.status !== 'failed'));
    if (finished) {
      if (d.date === state.date) { await openDay(d.date); toast('Transcript ready'); }
      else toast(`${shortDate(d.date)} is ready`);
    }
    if (was && was.job?.status !== 'failed' && d.job?.status === 'failed') toast(`Transcribing ${shortDate(d.date)} failed`);
  }
  const cur = libItem(state.date);
  if (cur && !isReady()) renderPending();
  if (cur && isReady()) renderBanner();
  if (!quiet) toast(`Library up to date · ${plural(state.library.length, 'day')}`);
  if (state.view === 'home') { renderHome(); if (!state.sync?.job?.running) refreshSync(); }
  schedulePoll(r.busy ? 2500 : state.view === 'home' ? 5000 : 20000);
}
function schedulePoll(ms) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(() => refreshLibrary(), ms);
}
