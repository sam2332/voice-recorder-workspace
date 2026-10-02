// One recording's row in the transcribe dialog.
import { GATE_OFF, RUSTLE_OPTS, SENS_LABELS, rustleName } from './levels';
import { playPreview } from './preview';
import { drawWave } from './wave';
import { el } from '../util/elements';
import { clock, fmt } from '../util/format';
import { toast } from '../util/toast';

export function clipRow(clip, defaultRustle) {
  const lv = clip.levels || {};
  clip.edit = { gain_db: lv.gain_db ?? 0, sensitivity: lv.sensitivity ?? 3, rustle: lv.rustle ?? null,
    gate_db: lv.gate_db ?? null, declip: !!lv.declip, auto: !!lv.auto };
  const row = el('div', 'clip' + (clip.issues?.length ? ' flagged' : ''));
  const head = el('div', 'clip-head');
  head.append(el('b', null, clock(clip.recorded_at) || clip.name), el('span', 'muted', fmt(clip.duration)));
  (clip.issues || []).forEach(i => head.append(el('span', 'chip ' + (i.code === 'clipping' ? 'failed' : 'pending'), i.label)));
  const autoChip = el('span', 'chip new', 'Auto-adjusted');
  autoChip.title = 'These levels were set automatically from the recording’s measurements';
  autoChip.classList.toggle('hidden', !clip.edit.auto);
  head.append(autoChip);
  const fix = el('button', 'btn small', 'Auto-adjust');
  fix.type = 'button';
  fix.title = clip.auto ? `Measured: ${clip.auto.notes.join(', ')}` : '';
  if (clip.auto) head.append(fix);
  row.append(head);
  (clip.issues || []).forEach(i => row.append(el('div', 'clip-issue', i.detail)));

  const cv = el('canvas', 'wave');
  cv.title = 'Click to hear 10 seconds from here with these settings (click again to stop)';
  clip.canvas = cv;
  cv.onclick = e => { const r = cv.getBoundingClientRect(); playPreview(clip, (e.clientX - r.left) / r.width * clip.duration); };
  row.append(cv);

  const ctrls = el('div', 'clip-ctrls');
  const manual = () => { clip.edit.auto = false; autoChip.classList.add('hidden'); };   // the user took over
  const slider = (label, min, max, step, value, fmtv, onchange, tip) => {
    const w = el('label', 'ctl'); w.title = tip;
    const top = el('span', 'ctl-top'); const val = el('span', 'ctl-val');
    top.append(el('span', null, label), val);
    const inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
    const upd = () => { val.textContent = fmtv(+inp.value); onchange(+inp.value); drawWave(clip); };
    inp.oninput = () => { upd(); manual(); }; val.textContent = fmtv(+inp.value);
    w.append(top, inp);
    return { w, inp, upd };
  };
  const gain = slider('Volume', -12, 30, 1, clip.edit.gain_db, v => (v > 0 ? '+' : '') + v + ' dB', v => clip.edit.gain_db = v,
    'Boost or lower this segment before transcription. Red on the waveform means it would clip.');
  const sens = slider('Speech sensitivity', 1, 5, 1, clip.edit.sensitivity, v => SENS_LABELS[v], v => clip.edit.sensitivity = v,
    'Higher picks up quieter or more distant voices, but also more noise.');
  const gate = slider('Noise gate', GATE_OFF, -20, 1, clip.edit.gate_db ?? GATE_OFF, v => v <= GATE_OFF ? 'Off' : v + ' dB',
    v => clip.edit.gate_db = v <= GATE_OFF ? null : v, 'Silences everything quieter than the dashed line (hiss, hum, room noise).');
  const rw = el('label', 'ctl'); rw.title = 'Turns down the scratchy sound of the mic rubbing on clothes';
  const rtop = el('span', 'ctl-top'); rtop.append(el('span', null, 'Rustle cleanup'));
  const rs = el('select');
  RUSTLE_OPTS.forEach(([v, n]) => { const o = el('option', null, v === '' ? `Default (${rustleName(defaultRustle)})` : n); o.value = v; rs.append(o); });
  rs.value = clip.edit.rustle === null ? '' : String(+clip.edit.rustle);
  rs.onchange = () => { clip.edit.rustle = rs.value === '' ? null : +rs.value; manual(); };
  rw.append(rtop, rs);
  ctrls.append(gain.w, sens.w, gate.w, rw);
  const dc = el('label', 'ctl check');
  const dci = el('input'); dci.type = 'checkbox'; dci.checked = clip.edit.declip;
  dci.onchange = () => { clip.edit.declip = dci.checked; drawWave(clip); manual(); };
  dc.append(dci, el('span', null, 'Repair clipping'));
  dc.title = 'Rebuilds peaks that were cut off because the recording was too loud';
  if (clip.issues?.some(i => i.code === 'clipping') || clip.edit.declip) ctrls.append(dc);
  row.append(ctrls);

  // Auto-adjust: best-guess levels from the recording's measurements
  clip.autoAdjust = (quiet = false) => {
    const s = clip.auto.levels;
    gain.inp.value = s.gain_db; gain.upd();
    sens.inp.value = s.sensitivity; sens.upd();
    gate.inp.value = s.gate_db ?? GATE_OFF; gate.upd();
    rs.value = s.rustle === null ? '' : String(+s.rustle); clip.edit.rustle = s.rustle;
    dci.checked = s.declip; clip.edit.declip = s.declip;
    if (s.declip && !dc.isConnected) ctrls.append(dc);
    drawWave(clip);
    clip.edit.auto = true; autoChip.classList.remove('hidden');
    if (!quiet) toast(clip.auto.problems.length
      ? `Adjusted, but ${clip.auto.problems.join('; ')}. Listen before continuing.`
      : `Auto-adjusted: ${clip.auto.notes.join(', ')}. Click the waveform to listen.`);
  };
  fix.onclick = () => clip.autoAdjust();
  return row;
}
