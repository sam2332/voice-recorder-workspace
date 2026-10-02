// Exporting the transcript as text.
import { state } from './core/state';
import { clockAt, displayName, isReady, srcIndexAt } from './day/helpers';
import { el } from './util/elements';
import { clock, fmt, longDate } from './util/format';

export function exportTxt() {
  if (!isReady()) return;
  const lines = [`Transcript: ${longDate(state.date)}`, ''];
  let last = null, lastSrc = -1;
  for (const s of state.segments) {
    if (state.hidden.has(s.speaker)) continue;
    const src = srcIndexAt(s.start);
    if (src !== lastSrc && src >= 0 && state.sources.length > 1) {
      lines.push('', `=== Recording ${src + 1} (${clock(state.sources[src].recorded_at) || fmt(state.sources[src].start)}) ===`);
      last = null;
    }
    lastSrc = src;
    if (s.speaker !== last) { lines.push('', `[${clockAt(s.start) || fmt(s.start)}] ${displayName(s.speaker)}:`); last = s.speaker; }
    lines.push(s.text);
  }
  const blob = new Blob([lines.join('\n').trim() + '\n'], { type: 'text/plain' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `${state.date}_transcript.txt`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
