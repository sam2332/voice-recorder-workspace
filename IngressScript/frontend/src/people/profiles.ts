// Stored voice profiles (People page section).
import { ICONS } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { go } from '../library/library';
import { showPeople } from './page';
import { playSnip } from '../review/snippets';
import { api } from '../util/api';
import { el, svg } from '../util/elements';
import { fmtDur, plural, shortDate } from '../util/format';
import { toast } from '../util/toast';

// A person's voice profile: the samples it was learned from (play / remove), and rename, merge, TV and delete
export function profileSection(name, prof, isTv) {
  const box = el('details', 'vprof');
  const prints = prof?.prints || [];
  box.append(el('summary', null, prints.length ? `Voice profile · ${plural(prints.length, 'sample')}` : 'Voice profile · no samples (not recognised by voice)'));
  const post = (url, body, method = 'POST') => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const reload = (n?: string) => showPeople(n);

  for (const pr of prints) {
    const row = el('div', 'vprint');
    const top = el('div', 'row');
    const when = pr.day === 'legacy' ? 'Old sample (from before per-day samples)' : pr.day === 'lines' ? 'Taught from lines' : shortDate(pr.day);
    top.append(el('b', null, when),
      el('span', 'muted', [pr.label === 'lines' ? 'taught from single lines' : pr.seconds ? `${fmtDur(pr.seconds)} of speech` : '',
        pr.heard_as && pr.heard_as !== name ? `heard as ${displayName(pr.heard_as)} that day` : ''].filter(Boolean).join(' · ')),
      el('span', 'grow'));
    if (pr.day && pr.day !== 'legacy') { const o = el('button', 'btn small', 'Open day'); o.onclick = () => go(pr.day); top.append(o); }
    const rm = el('button', 'btn small', 'Remove sample');
    rm.title = 'This sample is the wrong voice: stop using it to recognise them';
    rm.onclick = async () => {
      if (rm.dataset.sure !== '1') { rm.dataset.sure = '1'; rm.textContent = 'Click again to remove'; return; }
      try { await post(`/api/voices/prints/${pr.id}`, null, 'DELETE'); } catch (e) { toast(e.message); return; }
      toast(`Removed a sample from ${displayName(name)}`); reload(name);
    };
    top.append(rm); row.append(top);
    for (const s of pr.samples || []) {
      const b = el('button', 'vr-snip'); b.type = 'button';
      b.append(svg(ICONS.play), el('span', null, s.text));
      b.title = 'Play this line';
      b.onclick = () => playSnip(s, b, pr.audio);
      row.append(b);
    }
    if (pr.day !== 'legacy' && !(pr.samples || []).length) row.append(el('p', 'muted', 'No clean lines to play from this day.'));
    box.append(row);
  }

  // Actions
  const act = el('div', 'vprof-actions');
  const rename = el('input'); rename.placeholder = 'New name, then Enter'; rename.value = '';
  rename.onkeydown = async e => {
    if (e.key !== 'Enter' || !rename.value.trim()) return;
    const to = rename.value.trim();
    try { await post('/api/speakers/rename', { old: name, new: to, merge: false }); }
    catch (err) { toast(err.message.includes('409') || /exists|taken/i.test(err.message) ? `${to} already exists: use Merge instead` : err.message); return; }
    toast(`Renamed to ${to} everywhere`); reload(to);
  };
  const merge = el('select');
  const m0 = el('option', null, 'Merge into…'); m0.value = ''; merge.append(m0);
  (state.profiles || []).map(v => v.name).concat((state.people || []).map(p => p.name))
    .filter((n, i, a) => n !== name && a.indexOf(n) === i).sort((a, b) => a.localeCompare(b))
    .forEach(n => { const o = el('option', null, displayName(n)); o.value = n; merge.append(o); });
  merge.onchange = async () => {
    const to = merge.value; if (!to) return;
    const ok = el('button', 'btn small primary', `Merge ${displayName(name)} into ${displayName(to)}`);
    ok.onclick = async () => {
      try { await post('/api/speakers/rename', { old: name, new: to, merge: true }); } catch (e) { toast(e.message); return; }
      toast(`${displayName(name)} merged into ${displayName(to)} on every day`); reload(to);
    };
    act.querySelector('.merge-ok')?.remove(); ok.classList.add('merge-ok'); merge.after(ok);
  };
  const kind = el('button', 'btn small', isTv ? 'Not TV: a person' : 'Mark as TV / YouTube');
  kind.title = isTv ? 'Count them as a person again (shows in “who I saw” and talk time)' : 'A YouTuber or show: still transcribed and summarised, but not counted as someone you saw';
  kind.onclick = async () => {
    try { await post('/api/voices/kind', { name, tv: !isTv }); } catch (e) { toast(e.message); return; }
    toast(isTv ? `${displayName(name)} is a person` : `${displayName(name)} is TV / YouTube`); reload(name);
  };
  act.append(rename, merge, kind);
  if (prof) {
    const del = el('button', 'btn small danger', 'Delete profile');
    del.title = 'Forget this voice. Lines in transcripts keep the name; new days won’t recognise it.';
    del.onclick = async () => {
      if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = 'Click again to delete'; return; }
      try { await post('/api/voices/delete', { name }); } catch (e) { toast(e.message); return; }
      toast(`Deleted ${displayName(name)}’s voice profile`); reload();
    };
    act.append(del);
  }
  box.append(act);
  return box;
}
