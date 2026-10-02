// Queueing days for transcription and cancelling them.
import { refreshLibrary } from './library';
import { api } from '../util/api';
import { plural } from '../util/format';
import { toast } from '../util/toast';

export async function transcribe(dates: string[], hint?: Record<string, number> | null) {
  try {
    for (const d of dates) await api(`/api/days/${d}/process`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hint === undefined ? {} : { hint }),
    });
    toast(dates.length > 1 ? `Queued ${plural(dates.length, 'day')}` : 'Transcription started');
  } catch (e) { toast(e.message); }
  refreshLibrary();
}
export async function cancel(date) {
  try { await api(`/api/days/${date}/process`, { method: 'DELETE' }); toast('Removed from queue'); }
  catch (e) { toast(e.message); }
  refreshLibrary();
}
