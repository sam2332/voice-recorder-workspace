// One meeting's detail view.
import { $ } from '../core/dom';
import { displayName } from '../day/helpers';
import { btn, progressBar } from '../home/widgets';
import { go } from '../library/library';
import { meetingStats, mt } from './data';
import { loadMeetingsPage, showMeetings } from './page';
import { renderMarkdown } from '../summary/markdown';
import { api, jsonPost } from '../util/api';
import { el, svg } from '../util/elements';
import { fmtDur, longDate } from '../util/format';
import { toast } from '../util/toast';

export function renderMeetingDetail(inner) {
  const m = mt.detail;
  $('subtitle').textContent = m.name;
  const frag = document.createDocumentFragment();
  const back = btn('\u2190 All meetings', 'small', () => showMeetings());
  const top = el('div', 'mt-top'); top.style.marginTop = '12px';
  top.append(el('h2', 'hello', m.name));
  (top.lastChild as HTMLElement).style.flex = '1';
  top.append(btn('Rename', 'small', async () => {
    const n = prompt('Meeting name', m.name);
    if (!n || !n.trim() || n.trim() === m.name) return;
    try { await jsonPost(`/api/meetings/${m.id}/rename`, { name: n.trim() }); } catch (e) { toast(e.message); return; }
    loadMeetingsPage();
  }), btn('Delete', 'small danger', async () => {
    if (!confirm(`Delete \u201c${m.name}\u201d? The transcripts are not touched.`)) return;
    try { await api(`/api/meetings/${m.id}`, { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
    toast('Meeting deleted'); showMeetings();
  }));
  frag.append(back, top, meetingStats(m));
  if (m.people.length) {
    const who = el('div');
    m.people.forEach(p => who.append(el('span', 'ov-person', `${displayName(p.name)} \u00b7 ${fmtDur(p.seconds)}`)));
    frag.append(who);
  }

  // Status summary
  const r = m.summary_state;
  const box = el('section', 'summary');
  const sh = el('div', 'summary-head');
  const h3 = el('h3'); h3.append(svg('<path d="M4 6h16M4 12h10M4 18h13"/>'), 'Status');
  sh.append(h3, el('span', 'meta', r.status === 'ready' ? `${r.model}` : ''));
  const busy = ['queued', 'running'].includes(r.status);
  const run = () => jsonPost(`/api/meetings/${m.id}/summary`, {}).then(loadMeetingsPage).catch(e => toast(e.message));
  if (r.status === 'ready' && !busy) {
    const copy = btn('Copy', 'small', () => navigator.clipboard.writeText(r.markdown.replace(/\s*\[L[\d\sL,\u2013-]*\]/g, '')).then(() => toast('Summary copied')));
    sh.append(copy, btn('Regenerate', 'small', run));
  }
  box.append(sh);
  const body = el('div', 'summary-body');
  if (busy) {
    body.append(progressBar(r.progress || 0, (r.label || 'Waiting') + '\u2026', r.progress ? `${Math.round(r.progress * 100)}%` : ''),
      el('p', 'note', 'Runs on this computer with Ollama.'));
  } else if (r.status === 'failed') {
    const a = el('div', 'actions'); a.append(btn('Try again', 'primary small', run));
    body.append(el('div', 'error-box', r.error || 'Something went wrong'), a);
  } else if (r.status === 'ready') {
    if (r.outdated) {
      const st = el('div', 'stale');
      st.append(el('span', null, 'Lines were added or changed since this summary was written.'), btn('Regenerate', 'small', run));
      body.append(st);
    }
    body.append(renderMarkdown(r.markdown, r.refs || {}, { doneKey: 'meetingDone:' + m.id }));
  } else if (!m.lines) {
    body.append(el('p', 'lead', 'This meeting has no lines yet.'));
  } else {
    body.append(el('p', 'lead', `Where things stand, decisions, action items and open questions, written by ${r.model} on this computer.`));
    const a = el('div', 'actions'); a.append(btn('Summarize this meeting', 'primary', run));
    body.append(a);
  }
  box.append(body);
  frag.append(box);

  // The marked lines, by day
  let day = null;
  for (const l of m.transcript) {
    if (l.date !== day) {
      day = l.date;
      frag.append(el('div', 'mt-day', longDate(day)));
    }
    const row = el('div', 'mt-line');
    const when = el('button', 'prec', l.at); when.title = 'Open this moment'; when.onclick = () => go(l.date, l.start);
    const text = el('div'); text.append(el('span', 'who', displayName(l.speaker) + ': '), l.text);
    const rm = el('button', 'btn small', 'Remove'); rm.title = 'Take this line out of the meeting';
    rm.onclick = async () => {
      try { await jsonPost(`/api/meetings/${m.id}/items`, { remove: [{ date: l.date, start: l.start, text: l.text }] }); } catch (e) { toast(e.message); return; }
      loadMeetingsPage();
    };
    row.append(when, text, rm);
    frag.append(row);
  }
  inner.replaceChildren(frag);
}
