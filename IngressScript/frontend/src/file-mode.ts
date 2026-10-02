// File mode (viewer opened from disk): picking or dropping the processed_daily folder.
import { $ } from './core/dom';
import { state } from './core/state';
import { normalizeSources, showApp } from './day/open';
import { toast } from './util/toast';

export async function ingest(files) {
  const jsons = files.filter(f => /\.json$/i.test(f.name) && !/(\.sources|summary|clip_levels|settings)\.json$/i.test(f.name));
  const audios = files.filter(f => /\.(wav|mp3|m4a|ogg|flac)$/i.test(f.name) || f.type.startsWith('audio/'));
  if (!jsons.length) { toast('No transcript (.json) found in that selection.'); return; }

  const days = {};
  for (const f of jsons) {
    let data;
    try { data = JSON.parse(await f.text()); } catch { continue; }
    if (!data || !Array.isArray(data.segments)) continue;
    const date = data.date || f.name.replace(/_transcript\.json$/i, '').replace(/\.json$/i, '');
    const wanted = data.audio ? data.audio.split(/[\\/]/).pop().toLowerCase() : null;
    // Days live in their own folders (processed_daily/2026-10-02/merged.wav): match within the folder
    const folder = x => (x.relPath || x.webkitRelativePath || x.name).replace(/[^\\/]*$/, '');
    const match = audios.find(a => folder(a) === folder(f) && a.name.toLowerCase() === wanted)
      || (!folder(f) && audios.find(a => a.name.toLowerCase() === wanted))
      || audios.find(a => a.name.toLowerCase().startsWith(date.toLowerCase()))
      || (jsons.length === 1 && audios.length === 1 ? audios[0] : null);
    days[date] = { data: { ...data, status: 'ready' }, audio: match || null };
  }
  const dates = Object.keys(days).sort().reverse();
  if (!dates.length) { toast("Those files don't look like transcripts."); return; }

  state.files = days;
  state.library = dates.map(date => {
    const { data } = days[date];
    const segs = data.segments, talk = {};
    segs.forEach(s => talk[s.speaker] = (talk[s.speaker] || 0) + (s.end - s.start));
    const times = normalizeSources(data.sources).map(s => s.recorded_at).filter(Boolean).sort();
    return {
      date, status: 'ready', duration: segs.length ? segs[segs.length - 1].end : 0,
      recordings: (data.sources || []).length, speakers: Object.keys(talk).sort((a, b) => talk[b] - talk[a]),
      first_time: times[0] || null, last_time: times[times.length - 1] || null, new_recordings: 0,
    };
  });
  showApp();
}

// Drag & drop (folders included), file mode only
async function walk(entry, out) {
  if (entry.isFile) {
    const f = await new Promise<File & { relPath?: string }>((res, rej) => entry.file(res, rej));
    f.relPath = entry.fullPath;   // keep the folder: every day's audio is called merged.wav
    out.push(f); return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await walk(e, out);
    } while (batch.length);
  }
}

export function init(): void {
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (!state.server) $('drop').classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === 'drop' || !(e as DragEvent).relatedTarget) $('drop').classList.remove('over'); }));
  document.addEventListener('drop', async e => {
    if (state.server) return;
    const items = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const files = [];
    if (items.length) { for (const it of items) await walk(it, files); } else files.push(...e.dataTransfer.files);
    if (files.length) ingest(files);
  });
}
