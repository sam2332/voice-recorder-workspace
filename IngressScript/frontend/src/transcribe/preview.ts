// Previewing a recording through its level settings.
import { audio } from '../core/dom';
import { drawWave } from './wave';
import { toast } from '../util/toast';

export const preview = new Audio();
export let previewing = null;

export function stopPreview() {
  preview.pause();
  if (previewing) { const p = previewing; previewing = null; drawWave(p.clip); }
}

export function playPreview(clip, t) {
  if (previewing && previewing.clip === clip && Math.abs(previewing.start - t) < 0.5) { stopPreview(); return; }
  stopPreview();
  audio.pause();
  const lv = clip.edit;
  const q = new URLSearchParams({ start: t.toFixed(2), gain_db: lv.gain_db, declip: lv.declip });
  if (lv.gate_db !== null) q.set('gate_db', lv.gate_db);
  if (lv.rustle !== null) q.set('rustle', lv.rustle);
  preview.src = `/api/clips/${encodeURIComponent(clip.name)}/preview?${q}`;
  previewing = { clip, start: t };
  preview.play().catch(e => toast(`Couldn't play the preview: ${e.message}`));
  const tick = () => { if (previewing?.clip === clip) { drawWave(clip); requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
}

export function init(): void {
  preview.addEventListener('ended', stopPreview);
}
