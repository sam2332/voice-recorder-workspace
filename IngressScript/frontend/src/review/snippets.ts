// Playing short snippets of a voice without moving the main player.
import { ICONS, audio } from '../core/dom';
import { state } from '../core/state';
import { svg } from '../util/elements';
import { toast } from '../util/toast';

// One card per voice: unsure ones open at the top, recognised ones folded below with a one-click confirm.
const snip = new Audio();
let snipEnd = 0;
export let snipBtn: HTMLElement | null = null;
export const SNIPS = 5;

export function stopSnip() {
  snip.pause();
  snipBtn?.classList.remove('playing');
  snipBtn?.querySelector('svg')?.replaceWith(svg(ICONS.play));
  snipBtn = null;
}

export function playSnip(seg, b, url = state.data?.audio_url) {
  if (snipBtn === b) { stopSnip(); return; }
  stopSnip();
  if (!url) { toast('No audio for this day'); return; }
  if (!audio.paused) audio.pause();
  if (snip.getAttribute('src') !== url) snip.src = url;
  snipEnd = Math.min(seg.end, seg.start + 15) + 0.15;
  const go = () => { snip.currentTime = Math.max(0, seg.start - 0.1); snip.play().catch(e => toast(`Couldn't play: ${e.message}`)); };
  snip.readyState >= 1 ? go() : snip.addEventListener('loadedmetadata', go, { once: true });
  if (snip.readyState < 1) snip.load();
  snipBtn = b; b.classList.add('playing');
  b.querySelector('svg')?.replaceWith(svg(ICONS.pause));
}

// The clearest lines for a voice: real speech, nobody talking over it, longest first (2-15 s preferred)
export function voiceSnippets(spk) {
  const lines = state.segments.filter(x => x.speaker === spk && !x.noise && !x.overlap?.length);
  const score = x => { const d = x.end - x.start; return d < 1.2 ? d - 100 : Math.min(d, 15) - Math.max(0, d - 15) * 0.2; };
  return lines.sort((a, b) => score(b) - score(a));
}

export function init(): void {
  snip.preload = 'none';
  state.reviewNamed = new Set();
  state.reviewDraft = new Map();
  state.reviewOk = new Set();
  state.reviewSeen = new Set();
  snip.addEventListener('timeupdate', () => { if (snip.currentTime >= snipEnd) stopSnip(); });
  snip.addEventListener('ended', stopSnip);
}
