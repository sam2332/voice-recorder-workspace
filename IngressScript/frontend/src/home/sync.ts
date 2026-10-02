// Recorder sync on Home.
import { $ } from '../core/dom';
import { state } from '../core/state';
import { renderHome } from './home';
import { refreshLibrary } from '../library/library';
import { api } from '../util/api';
import { plural } from '../util/format';
import { toast } from '../util/toast';

export async function refreshSync() {
  try {
    const r = await api('/api/sync');
    const was = state.sync?.job;
    state.sync = r;
    // A sync just finished: tell the user and refresh the library so the new days appear
    if (was?.running && !r.job.running) {
      if (r.job.error) toast(`Sync stopped: ${r.job.error}`);
      else toast(`${r.mode === 'move' ? 'Moved' : 'Copied'} ${plural(r.job.files_done, 'recording')}`
        + (state.settings?.auto_transcribe ? '. Transcribing now.' : '. Press Transcribe when you’re ready.'));
      refreshLibrary();
    }
  } catch { /* server busy; next poll */ }
  $('lib-home-dot').classList.toggle('hidden', !(state.sync?.recorders || []).some(r => r.new > 0));
  if (state.view === 'home') renderHome();
  if (state.sync?.job?.running) { clearTimeout(state.syncTimer); state.syncTimer = setTimeout(refreshSync, 1000); }
}

export async function startSync(rec) {
  if (state.syncMode === 'move' && !confirm(`Move ${plural(rec.new, 'recording')} off ${rec.label}? They'll be deleted from the recorder after each copy is checked.`)) return;
  try {
    state.sync.job = await api('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: rec.root }) });

  } catch (e) { toast(e.message); }
  refreshSync();
}
