// Day summary (local Ollama).
import { $ } from '../core/dom';
import { state } from '../core/state';
import { clockAt, isReady } from '../day/helpers';
import { btn, progressBar } from '../home/widgets';
import { renderMarkdown } from './markdown';
import { api } from '../util/api';
import { el, svg } from '../util/elements';
import { fmt } from '../util/format';
import { store } from '../util/store';
import { toast } from '../util/toast';

export async function loadSummary(date) {
  if (!state.server || !date) { $('summary-wrap').replaceChildren(); return; }
  let r;
  try { r = await api(`/api/days/${date}/summary`); } catch { return; }
  if (state.date !== date) return;
  const wasBusy = state.summary?.date === date && ['queued', 'running'].includes(state.summary.status);
  state.summary = { ...r, date };
  renderSummary();
  clearTimeout(state.summaryTimer);
  if (['queued', 'running'].includes(r.status)) state.summaryTimer = setTimeout(() => loadSummary(date), 2500);
  else if (wasBusy && r.status === 'ready') toast('Summary ready');
  else if (wasBusy && r.status === 'failed') toast('The summary didn’t work; see the message above the transcript');
}

async function startSummary() {
  const date = state.date;
  try { await api(`/api/days/${date}/summary`, { method: 'POST' }); } catch (e) { toast(e.message); return; }
  store.set('summaryOpen', true);
  loadSummary(date);
}

function renderSummary() {
  const wrap = $('summary-wrap');
  const r = state.summary;
  if (!state.server || !isReady() || !r || r.date !== state.date) { wrap.replaceChildren(); return; }
  const open = store.get('summaryOpen', true);
  const box = el('section', 'summary' + (open ? '' : ' collapsed'));
  const head = el('div', 'summary-head');
  const h = el('h3'); h.append(svg('<path d="M4 6h16M4 12h10M4 18h13"/>'), 'Summary');
  const when = r.created ? new Date(r.created * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  head.append(h, el('span', 'meta', r.status === 'ready' ? `${r.model} · ${when}` : r.model || ''));
  const busy = ['queued', 'running'].includes(r.status);
  if (r.status === 'ready' && !busy) {
    const copy = el('button', 'btn small', 'Copy');
    copy.title = 'Copy the summary as Markdown';
    copy.onclick = e => { e.stopPropagation(); navigator.clipboard.writeText(withTimes(r.markdown, r.refs)).then(() => toast('Summary copied')); };
    const again = el('button', 'btn small', 'Regenerate');
    again.onclick = e => { e.stopPropagation(); startSummary(); };
    head.append(copy, again);
  }
  const chev = el('button', 'icon-btn'); chev.append(svg('<path d="m6 9 6 6 6-6"/>', 'chev'));
  chev.title = open ? 'Collapse' : 'Expand'; chev.setAttribute('aria-label', chev.title);
  head.append(chev);
  head.style.cursor = 'pointer';
  head.onclick = () => { store.set('summaryOpen', !open); renderSummary(); };
  box.append(head);

  const body = el('div', 'summary-body');
  if (busy) {
    body.append(progressBar(r.progress || 0, (r.label || 'Waiting') + '…', r.progress ? `${Math.round(r.progress * 100)}%` : ''),
      el('p', 'note', 'Runs on this computer with Ollama. A long day takes a few minutes; you can keep listening meanwhile.'));
  } else if (r.status === 'failed') {
    const a = el('div', 'actions'); a.append(btn('Try again', 'primary small', startSummary));
    body.append(el('div', 'error-box', r.error || 'Something went wrong'), a);
  } else if (r.status === 'ready') {
    if (r.outdated) {
      const st = el('div', 'stale');
      st.append(el('span', null, 'The transcript has changed since this summary was written.'), btn('Regenerate', 'small', startSummary));
      body.append(st);
    }
    body.append(renderMarkdown(r.markdown, r.refs || {}));
  } else {
    body.append(el('p', 'lead', `Overview, conversations, shopping list, project ideas, to-dos and key facts for this day, written by ${r.model} on this computer.`));
    const a = el('div', 'actions'); a.append(btn('Summarize this day', 'primary', startSummary));
    body.append(a);
  }
  box.append(body);
  wrap.replaceChildren(box);
}

// [L12] -> "9:43 AM" for copying the summary as plain Markdown
const withTimes = (md, refs) => md.replace(/\[(L\d+(?:\s*[-–,]\s*L?\d+)*)\]/g, (m, list) =>
  '(' + list.split(/\s*,\s*/).map(part => part.split(/\s*[-–]\s*/).map(x => 'L' + x.replace(/^L/, ''))
    .map(r => refs[r] !== undefined ? (clockAt(refs[r]) || fmt(refs[r])) : r).join('–')).join(', ') + ')');
