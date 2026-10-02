// Drawing a recording's waveform.
import { dbToLin } from './levels';
import { preview, previewing } from './preview';

// Waveform: grey = the original, colour = after gain; red = clipping; dim = silenced by the gate
export function drawWave(clip) {
  const cv = clip.canvas; if (!cv || !clip.peaks?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const col = { accent: css.getPropertyValue('--accent'), danger: css.getPropertyValue('--danger'),
    muted: css.getPropertyValue('--muted'), border: css.getPropertyValue('--border'), warn: css.getPropertyValue('--warn') };
  const mid = H / 2, half = H / 2 - 2;
  const gain = dbToLin(clip.edit.gain_db);
  const gate = clip.edit.gate_db === null ? 0 : dbToLin(clip.edit.gate_db);
  const n = clip.peaks.length;
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor(x / W * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * n));
    let p = 0, r = 0, rawClip = false;
    for (let i = i0; i < i1 && i < n; i++) { p = Math.max(p, clip.peaks[i]); r = Math.max(r, clip.rms[i]); if (clip.peaks[i] >= 0.98) rawClip = true; }
    // original, faint and wide
    g.fillStyle = col.border; g.fillRect(x, mid - Math.min(p, 1) * half, 1, Math.max(1, Math.min(p, 1) * half * 2));
    const pg = p * gain, rg = r * gain;
    // red = clipped (in the recording, or by the extra volume); amber = clipped but being repaired
    const clipped = (gain > 1 && pg >= 1) || (rawClip && !clip.edit.declip);
    const repaired = rawClip && clip.edit.declip && !clipped;
    const gated = gate && rg < gate;
    g.fillStyle = clipped ? col.danger : repaired ? col.warn : gated ? col.muted : col.accent;
    g.globalAlpha = gated ? 0.35 : 0.9;
    const h = Math.min(pg, 1) * half;
    g.fillRect(x, mid - h, 1, Math.max(1, h * 2));
    g.globalAlpha = 1;
  }
  g.strokeStyle = col.border; g.setLineDash([]); g.beginPath();
  g.moveTo(0, 2.5); g.lineTo(W, 2.5); g.moveTo(0, H - 2.5); g.lineTo(W, H - 2.5); g.stroke();   // full scale
  if (gate) {
    g.strokeStyle = col.muted; g.setLineDash([4, 4]); g.beginPath();
    const y = Math.min(gate, 1) * half;
    g.moveTo(0, mid - y); g.lineTo(W, mid - y); g.moveTo(0, mid + y); g.lineTo(W, mid + y); g.stroke();
    g.setLineDash([]);
  }
  if (previewing?.clip === clip) {
    const t = previewing.start + (preview.currentTime || 0);
    const xp = t / clip.duration * W;
    g.fillStyle = col.danger; g.fillRect(xp, 0, 2, H);
  }
}
