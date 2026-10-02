// Overview page: state and loading.
import { $, audio } from '../core/dom';
import { state } from '../core/state';
import { closeDrawers } from '../drawers';
import { renderLibrary, updateNav } from '../library/library';
import { renderOverview } from './render';
import { savePosition } from '../player/audio';
import { renderTeachTray } from '../teach/tray';
import { api } from '../util/api';
import { el } from '../util/elements';

export const KINDS = { fact: 'Memory', interaction: 'Interaction', task: 'To-do', shopping: 'Shopping', idea: 'Idea', decision: 'Decision', plan: 'Plan' };
export const ov: {
  q: string; kind: string; person: string; hideDone: boolean; built: boolean; timer: ReturnType<typeof setTimeout> | null;
  // nodes built once by renderOverview
  status?: HTMLElement; filters?: HTMLElement; tabs?: HTMLElement; personSel?: HTMLSelectElement;
  count?: HTMLElement; tableWrap?: HTMLElement; saw?: HTMLElement;
} = { q: '', kind: '', person: '', hideDone: false, built: false, timer: null };

export async function showOverview() {
  if (state.view === 'day') savePosition();
  state.view = 'overview';
  state.date = null;
  renderTeachTray();
  state.openToken++;
  audio.pause();
  $('app').classList.add('is-home');
  $('title').textContent = 'Overview';
  document.title = 'Overview · Recorder Playback';
  closeDrawers(); renderLibrary(); updateNav();
  $('home').scrollTop = 0;
  ov.built = false;
  $('home-inner').replaceChildren(el('div', 'note', 'Gathering the last 30 days…'));
  await loadOverview();
  // Days with no (or outdated) extraction are filled in by the server, one at a time, in the background
  try { await api('/api/overview/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch {}
  loadOverview();
}

export async function loadOverview() {
  clearTimeout(ov.timer);
  try { state.overview = await api('/api/overview'); }
  catch (e) {
    if (state.view === 'overview') $('home-inner').replaceChildren(el('div', 'error-box', `Couldn’t load the overview: ${e.message}`));
    return;
  }
  if (state.view !== 'overview') return;
  renderOverview();
  const x = state.overview.extractor;
  if (x.current || x.queued.length) ov.timer = setTimeout(() => { if (state.view === 'overview') loadOverview(); }, 4000);
}

export const taskKey = r => `${r.date}|${r.text}`;

export function overviewRows() {
  const rows = [];
  for (const d of state.overview.days) for (const it of d.items) rows.push({ ...it, date: d.date });
  rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.start ?? 1e9) - (b.start ?? 1e9));
  return rows;
}
