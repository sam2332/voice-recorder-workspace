// Splitting a mixed voice: state and helpers.

// The user names up to 4 people and sorts lines with number keys (each plays by itself), longest
// (clearest) first. Once a few lines are tagged, the server suggests the rest by voice.
export const split = { spk: null, slots: [], order: [], i: 0, pick: new Map(), hist: [], sugg: new Map(), playBtn: null };
export const SKIP = '__skip__';

export const splitNames = () => split.slots.map(s => s.trim());
export const slotOf = name => splitNames().indexOf(name);

export function nextUnsorted(from) {
  for (let k = from; k < split.order.length; k++) if (!split.pick.has(split.order[k])) return k;
  for (let k = 0; k < from; k++) if (!split.pick.has(split.order[k])) return k;
  return -1;
}
