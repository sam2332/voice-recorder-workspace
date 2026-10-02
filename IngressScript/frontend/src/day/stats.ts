// Day details panel: stats and the re-transcribe banner.
import type { LibraryDay } from '../core/types';
import { $ } from '../core/dom';
import { state } from '../core/state';
import { isReady, libItem } from './helpers';
import { el } from '../util/elements';
import { fmtDur, plural } from '../util/format';

// People who said something real (a voice that only produced noise lines doesn't count)
const speakerCount = () => new Set(state.segments.filter(s => !s.noise).map(s => s.speaker)).size;

export function renderStats() {
  const lib: Partial<LibraryDay> = libItem(state.date) || {};
  const words = state.segments.reduce((n, s) => n + (s.noise ? 0 : (s.text.match(/\S+/g) || []).length), 0);
  const recs = state.sources.length || lib.recordings || 0;
  const unit = isReady() && state.sources.some(s => s.file) ? 'segment' : 'recording';
  const dur = state.duration || lib.duration || state.sources.reduce((n, s) => n + (s.duration || 0), 0);
  const items = isReady()
    ? [[fmtDur(dur), 'Length'], [words.toLocaleString(), 'Words'], [recs, plural(recs, unit[0].toUpperCase() + unit.slice(1)).replace(/^\d+ /, '')], [speakerCount(), 'Speakers']]
    : [[fmtDur(dur), 'Audio'], [recs, plural(recs, 'Recording').replace(/^\d+ /, '')]];
  $('stats').replaceChildren(...items.map(([v, l]) => { const s = el('div', 'stat'); s.append(el('b', null, String(v)), el('span', null, l)); return s; }));

  const bits = [fmtDur(dur)];
  if (recs) bits.push(plural(recs, unit));
  if (isReady()) bits.push(plural(speakerCount(), 'speaker'));
  else bits.push('not transcribed yet');
  $('subtitle').textContent = bits.join(' · ');
}

export function renderBanner() {
  const lib = libItem(state.date);
  const n = lib?.new_recordings || 0;
  const job = lib?.job;
  const busy = job && job.status !== 'failed';
  $('banner').classList.toggle('hidden', !n && !job);
  if (!n && !job) return;
  const pct = job?.status === 'processing' && job.progress ? ` ${Math.round(job.progress * 100)}%` : '';
  $('banner-text').textContent = busy
    ? (job.status === 'queued' ? 'Waiting to re-transcribe this day…' : `Re-transcribing this day… ${job.label}${pct}. The transcript below updates when it's done.`)
    : job?.status === 'failed' ? `Re-transcribing failed: ${job.error}`
    : `${plural(n, 'new recording')} from this day ${n === 1 ? "isn't" : "aren't"} in the transcript yet.`
      + (lib?.edited ? ' You’ve edited this day, so it won’t re-transcribe by itself.' : '');
  $('banner-btn').classList.toggle('hidden', !!busy);
  $('banner-btn').textContent = job?.status === 'failed' ? 'Try again' : 'Re-transcribe';
}
