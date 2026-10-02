// The setup / settings form on Home.
import { state } from '../core/state';
import { renderHome } from './home';
import { btn } from './widgets';
import { refreshLibrary } from '../library/library';
import { api } from '../util/api';
import { el } from '../util/elements';
import { toast } from '../util/toast';

const LANGS = [['', 'Detect automatically'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['zh', 'Chinese']];

export async function loadSettings(fresh = false) {
  try {
    const r = await api('/api/settings' + (fresh ? '?fresh=true' : ''));
    state.settings = r.settings; state.checks = r.checks; state.syncMode = r.sync_mode;
  } catch (e) { toast(`Couldn't load settings: ${e.message}`); }
  if (state.view === 'home') renderHome();
}

export async function saveSettings(patch, msg) {
  try {
    const r = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    state.settings = r.settings;
    if (msg) toast(msg);
  } catch (e) { toast(`Couldn't save: ${e.message}`); }
  renderHome(true);
  refreshLibrary();
}

export function settingsForm(onSave, saveLabel) {
  const s = state.settings || {};
  const form = el('div', 'form');
  const auto = el('input', 'switch'); auto.type = 'checkbox'; auto.checked = !!s.auto_transcribe;
  const l1 = el('label', 'row-l'); const t1 = el('div');
  t1.append(el('div', null, 'Transcribe new recordings automatically'), el('div', 'hint', 'Off: new days wait until you press Transcribe. On: they start as soon as they arrive.'));
  l1.append(t1, auto);

  const async = el('input', 'switch'); async.type = 'checkbox'; async.checked = !!s.auto_sync;
  const la = el('label', 'row-l'); const ta = el('div');
  ta.append(el('div', null, 'Sync recorder automatically on startup'), el('div', 'hint', 'If enabled, the app will automatically sync any plugged-in recorder when it starts.'));
  la.append(ta, async);

  const asum = el('input', 'switch'); asum.type = 'checkbox'; asum.checked = !!s.auto_summarize;
  const l_asum = el('label', 'row-l'); const t_asum = el('div');
  t_asum.append(el('div', null, 'Summarize recordings automatically'), el('div', 'hint', 'Off: summaries wait for you. On: they start as soon as the transcript is ready.'));
  l_asum.append(t_asum, asum);

  const lang = el('select'); LANGS.forEach(([v, n]) => { const o = el('option', null, n); o.value = v; lang.append(o); }); lang.value = s.language || '';
  const l2 = el('label', 'row-l'); const t2 = el('div');
  t2.append(el('div', null, 'Language'), el('div', 'hint', 'Choosing it avoids mistakes when a day starts with noise.'));
  l2.append(t2, lang);
  const rustle = el('select'); [['2', 'Maximum (also quiets rustle-only moments)'], ['1', 'Strong (recommended)'], ['0.5', 'Gentle'], ['0', 'Off']].forEach(([v, n]) => { const o = el('option', null, n); o.value = v; rustle.append(o); });
  rustle.value = String(+(s.rustle_strength ?? 1));
  const l3 = el('label', 'row-l'); const t3 = el('div');
  t3.append(el('div', null, 'Clothing-rustle cleanup'), el('div', 'hint', 'Turns down the scratchy sound of the mic rubbing on clothes. Voices are left alone.'));
  l3.append(t3, rustle);
  form.append(l1, la, l_asum, l2, l3);
  const actions = el('div', 'actions');
  actions.append(btn(saveLabel, 'primary', () => onSave({ auto_transcribe: auto.checked, auto_sync: async.checked, auto_summarize: asum.checked, language: lang.value, rustle_strength: +rustle.value })));
  form.append(actions);
  return form;
}
