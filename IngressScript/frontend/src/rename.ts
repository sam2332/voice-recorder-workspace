// Renaming / merging a speaker everywhere (double-click).
import { $ } from './core/dom';
import { state } from './core/state';
import { displayName } from './day/helpers';
import { openDay } from './day/open';
import { refreshLibrary } from './library/library';
import { api } from './util/api';
import { plural } from './util/format';
import { toast } from './util/toast';

export function rename(spk) {
  const dlg = $('rename-dlg'), input = $('rename-input');
  input.value = displayName(spk);
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const v = input.value.trim();
    if (!v || v === displayName(spk)) return;
    // Permanent: updates the voice DB and every transcript on disk
    try {
      // Typing "Speaker 2" means the existing Speaker_2
      const target = Object.keys(state.colors).find(k => displayName(k).toLowerCase() === v.toLowerCase() && k !== spk) || v;
      const send = merge => api('/api/speakers/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old: spk, new: target, merge }),
      });
      let r, merged = false;
      try { r = await send(false); }
      catch (e) {
        if (e.status !== 409) throw e;
        $('merge-text').textContent = `${displayName(target)} already exists. Merge ${displayName(spk)} into ${displayName(target)}? ` +
          `All of ${displayName(spk)}'s lines on every day become ${displayName(target)}, and their voiceprints are pooled so future recordings match better.`;
        const ok = await new Promise(res => { const d = $('merge-dlg'); d.onclose = () => res(d.returnValue === 'ok'); d.returnValue = ''; d.showModal(); });
        if (!ok) return;
        r = await send(true); merged = true;
      }
      await refreshLibrary();
      await openDay(state.date, { keepPosition: true });
      toast(merged ? `Merged into ${displayName(target)}` : `Renamed to ${v} in ${plural(r.updated, 'transcript')}`);
    } catch (e) { toast(e.message); }
  };
  dlg.showModal();
  input.select();
}
