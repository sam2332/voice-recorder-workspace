// Small lookups about the open day: names, readiness, which recording a time falls in.
import { state } from '../core/state';
import { clock } from '../util/format';

export const displayName = spk => state.renames[spk] || String(spk).replace(/_/g, ' ');
export const libItem = date => state.library.find(d => d.date === date);
export const isReady = () => state.data && state.data.status !== 'pending';
export const sourcesTimed = () => state.sources.length && state.sources.every(s => typeof s.start === 'number');
export function srcIndexAt(t) {
  if (!sourcesTimed()) return -1;
  let i = -1;
  for (let k = 0; k < state.sources.length; k++) if (state.sources[k].start <= t + 0.01) i = k;
  return i;
}
export function clockAt(t) {
  const i = srcIndexAt(t);
  return i < 0 ? null : clock(state.sources[i].recorded_at, t - state.sources[i].start);
}
