// The Home page.
import { $, audio } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { closeDrawers } from '../drawers';
import { activityCard } from './heat-grid';
import { saveSettings } from './settings';
import { startSync } from './sync';
import { HOME_ICONS, btn, cachedForm, card, checksList, progressBar } from './widgets';
import { go, renderLibrary, updateNav } from '../library/library';
import { transcribe } from '../library/queue';
import { savePosition } from '../player/audio';
import { renderTeachTray } from '../teach/tray';
import { askTranscribe, showBlocked } from '../transcribe/dialog';
import { el, svg } from '../util/elements';
import { fmtBytes, fmtDur, longDate, plural, shortDate } from '../util/format';

export function showHome() {
  if (state.view === 'day') savePosition();
  state.view = 'home';
  state.date = null;
  renderTeachTray();
  state.openToken++;
  audio.pause();
  $('app').classList.add('is-home');
  $('title').textContent = 'Recorder Playback';
  document.title = 'Recorder Playback';
  closeDrawers();
  renderHome(); renderLibrary(); updateNav();
  $('home').scrollTop = 0;
}

export function renderHome(force = false) {
  if (state.view !== 'home') return;
  // Don't redraw under someone who is using a form or button on the page
  if (!force && $('home').contains(document.activeElement) && document.activeElement.matches('select, input')) return;
  // Only redraw when something shown here actually changed (keeps buttons stable under the cursor)
  const sig = JSON.stringify([state.library, state.jobs, state.sync, state.settings, state.checks, state.renames]);
  if (!force && sig === state.homeSig && $('home-inner').childElementCount) return;
  state.homeSig = sig;
  const inner = $('home-inner');
  const lib = state.library;
  const s = state.settings || {};
  const frag = document.createDocumentFragment();

  const pending = lib.filter(d => d.status === 'pending' && !d.job);
  const ready = lib.filter(d => d.status === 'ready');
  $('subtitle').textContent = lib.length ? `${plural(lib.length, 'day')} · ${ready.length} transcribed` : 'No recordings yet';

  const hello = el('div');
  hello.append(el('h2', 'hello', s.setup_done ? 'Welcome back' : 'Welcome'),
    el('p', 'lead', s.setup_done ? 'Plug in the recorder and sync, or pick a day to listen to.' : 'Two quick steps: check the setup below, then sync your recorder. Nothing is transcribed until you say so.'));
  frag.append(hello);

  // 2. Recorder sync: only shown when a plugged-in drive has recordings that aren't copied yet
  const sync = state.sync || {};
  const job = sync.job || {};
  const recs = (sync.recorders || []).filter(r => r.new > 0);
  if (job.running || recs.length) {
    const verb = sync.mode === 'move' ? 'Move' : 'Copy';
    const rc = card('usb', job.running ? `${verb === 'Move' ? 'Moving' : 'Copying'} from ${job.label}` : `New recordings on ${recs[0].label}`, 'attention sync-card');
    if (job.running) {
      rc.append(el('p', null, 'Keep the recorder plugged in until this finishes.'));
      rc.append(progressBar(job.bytes_total ? job.bytes_done / job.bytes_total : 0,
        `${job.current || 'Starting'} (${Math.min(job.files_done + 1, job.files_total)} of ${job.files_total})`,
        job.bytes_total ? `${fmtBytes(job.bytes_done)} of ${fmtBytes(job.bytes_total)}` : ''));
    } else {
      for (const r of recs) {
        if (recs.length > 1) rc.append(el('div', 'sync-dev', r.label));
        rc.append(el('p', 'sync-what', `${plural(r.new, 'new recording')} (${fmtBytes(r.new_bytes)}) from ${r.days.map(shortDate).join(', ')}`
          + (r.quality ? ` · ${r.quality}` : '')));
        const a = el('div', 'actions');
        a.append(btn(`${verb === 'Move' ? 'Move' : 'Sync'} ${plural(r.new, 'recording')}`, 'primary big', () => startSync(r)));
        rc.append(a);
      }
      rc.append(el('p', 'note', (s.auto_transcribe
          ? 'Auto-transcribe is on: these days start transcribing as soon as they’re copied.'
          : 'Auto-transcribe is off: after copying, the days wait for you to press Transcribe.')
        + (sync.mode === 'move' ? ' Recordings are deleted from the recorder once each copy is checked.' : ' Recordings stay on the recorder too.')));
    }
    frag.append(rc);
  }

  // 1. First-run setup
  if (state.settings && !s.setup_done) {
    const c = card('gear', 'Set up', 'attention');
    c.append(el('p', null, 'Check that everything is ready, choose how you want it to work, then save.'));
    c.append(checksList(), cachedForm('setup', p => saveSettings({ ...p, setup_done: true }, 'Setup saved'), 'Save and finish setup'));
    frag.append(c);
  }

  frag.append(activityCard());

  // 3. Transcription status
  const jobs = state.jobs || {};
  const failed = lib.filter(d => d.job?.status === 'failed');
  const tc = card('wave', 'Transcription');
  if (jobs.blocked) {
    tc.append(el('p', null, `Paused: a recording on ${shortDate(jobs.blocked.date)} needs your levels before anything else is transcribed.`));
    const a = el('div', 'actions'); a.append(btn('Check it now', 'primary', () => showBlocked(jobs.blocked))); tc.append(a);
  } else if (jobs.current) {
    const cur = jobs.current;
    tc.append(el('p', null, `Working on ${longDate(cur.date)}` + ((jobs.queued || []).length ? ` · ${(jobs.queued || []).length} more waiting` : '')));
    tc.append(progressBar(cur.progress, cur.label + '…', cur.progress ? `${Math.round(cur.progress * 100)}%` : ''));
    const a = el('div', 'actions'); a.append(btn('Watch it', 'small', () => go(cur.date))); tc.append(a);
  } else if ((jobs.queued || []).length) {
    tc.append(el('p', null, `${plural(jobs.queued.length, 'day')} waiting to start.`));
  } else {
    tc.append(el('p', null, pending.length ? `${plural(pending.length, 'day')} not transcribed yet.` : lib.length ? 'Everything is transcribed.' : 'Nothing to transcribe yet. Sync the recorder first.'));
  }
  if (failed.length) tc.append(el('div', 'error-box', `${shortDate(failed[0].date)} failed: ${failed[0].job.error}`));
  const ta = el('div', 'actions');
  // One day: open the levels dialog. Several: queue them all (unusual recordings still pause for review)
  if (pending.length === 1) ta.append(btn(`Transcribe ${shortDate(pending[0].date)}…`, jobs.current ? '' : 'primary', () => askTranscribe('Transcribe', pending[0].date)));
  else if (pending.length) ta.append(btn(`Transcribe all ${pending.length} days`, jobs.current ? '' : 'primary', () => transcribe(pending.map(d => d.date).reverse())));
  tc.append(ta);
  tc.append(el('p', 'note', s.auto_transcribe ? 'Auto-transcribe is on: new recordings start by themselves.' : 'Auto-transcribe is off: new days wait for you. Change it in Settings below.'));
  frag.append(tc);

  // 4. Recent days
  if (lib.length) {
    const dc = card('cal', 'Your days');
    const tiles = el('div', 'tiles');
    for (const d of lib.slice(0, 8)) {
      const t = el('button', 'tile');
      const t1 = el('div', 't1'); t1.append(el('span', null, shortDate(d.date)));
      if (d.job?.status === 'processing') t1.append(el('span', 'chip processing', `${Math.round((d.job.progress || 0) * 100)}%`));
      else if (d.job) t1.append(el('span', 'chip ' + d.job.status, d.job.status === 'failed' ? 'Failed' : 'Queued'));
      else if (d.status === 'pending') t1.append(el('span', 'chip pending', 'New'));
      else if (d.needs_review) t1.append(el('span', 'chip pending', 'Name voices'));
      t.append(t1, el('div', 't2', [fmtDur(d.duration), plural(d.recordings || 0, 'recording')].join(' · ')));
      if (d.speakers?.length) t.append(el('div', 't2', d.speakers.slice(0, 3).map(displayName).join(', ')));
      t.onclick = () => go(d.date);
      tiles.append(t);
    }
    dc.append(tiles);
    if (lib.length > 8) dc.append(el('p', 'note', `All ${lib.length} days are in the library on the left.`));
    frag.append(dc);
  }

  // 5. Settings (after setup)
  if (state.settings && s.setup_done) {
    const det = el('details', 'card');
    det.id = 'settings-card';
    const sum = el('summary'); sum.append(svg(HOME_ICONS.gear), el('span', null, 'Settings'));
    det.append(sum, checksList(), cachedForm('settings', p => saveSettings(p, 'Settings saved'), 'Save settings'));
    det.open = !!state.settingsOpen;
    det.ontoggle = () => { state.settingsOpen = det.open; };
    frag.append(det);
  }
  inner.replaceChildren(frag);
}
