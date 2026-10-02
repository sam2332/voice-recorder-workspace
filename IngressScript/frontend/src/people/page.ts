// The People page.
import { $, PALETTE, audio } from '../core/dom';
import { state } from '../core/state';
import { displayName } from '../day/helpers';
import { closeDrawers } from '../drawers';
import { heatGrid, heatLegend } from '../home/heat-grid';
import { card } from '../home/widgets';
import { go, renderLibrary, updateNav } from '../library/library';
import { KINDS } from '../overview/data';
import { profileSection } from './profiles';
import { savePosition } from '../player/audio';
import { renderTeachTray } from '../teach/tray';
import { api } from '../util/api';
import { el } from '../util/elements';
import { clock, fmtDur, initials, longDate, plural, shortDate } from '../util/format';

export async function showPeople(focus?: string) {
  if (state.view === 'day') savePosition();
  state.view = 'people';
  state.date = null;
  renderTeachTray();
  state.openToken++;
  audio.pause();
  $('app').classList.add('is-home');
  $('title').textContent = 'People';
  document.title = 'People · Recorder Playback';
  closeDrawers(); renderLibrary(); updateNav();
  $('home').scrollTop = 0;
  $('home-inner').replaceChildren(el('div', 'note', 'Gathering everyone from your transcripts…'));
  try {
    const [pp, vv] = await Promise.all([api('/api/people'), api('/api/voices')]);
    state.people = pp.people; state.profiles = vv.profiles;
  }
  catch (e) { $('home-inner').replaceChildren(el('div', 'error-box', `Couldn't load people: ${e.message}`)); return; }
  if (state.view === 'people') renderPeople(focus);
}

function renderPeople(focus) {
  const profiles = Object.fromEntries((state.profiles || []).map(v => [v.name, v]));
  // Everyone in a transcript, plus voice profiles no transcript uses (yet)
  const people = [...(state.people || []).map(p => ({ ...p, tv: p.tv || !!profiles[p.name]?.tv }))];
  for (const v of state.profiles || []) if (!people.some(p => p.name === v.name))
    people.push({ name: v.name, tv: v.tv, days: [], recordings: 0, seconds: 0, voiceprints: v.prints.length, profileOnly: true });
  const humans = people.filter(p => !p.tv), tv = people.filter(p => p.tv);
  $('subtitle').textContent = `${plural(humans.length, 'person')} across your transcripts`.replace('persons', 'people');
  const frag = document.createDocumentFragment();
  const head = el('div');
  head.append(el('h2', 'hello', 'People'),
    el('p', 'lead', 'Everyone named in your transcripts: the recordings they’re in and the days they were heard. Open “Voice profile” to listen to the samples each voice was learned from.'));
  frag.append(head);
  if (!people.length) {
    const c = card('mic', 'No people yet');
    c.append(el('p', null, 'Once a day is transcribed, the voices in it show up here.'));
    frag.append(c);
  }
  let i = -1;
  const section = (list, title) => { if (list.length && title) frag.append(el('div', 'vr-sect', title)); list.forEach(p => personCard(p, ++i)); };
  const personCard = (p, i) => {
    const c = el('details', 'card person');
    c.open = focus ? p.name === focus : i < 3 && !p.profileOnly;
    const sum = el('summary');
    const av = el('span', 'avatar', initials(displayName(p.name)));
    av.style.background = PALETTE[i % PALETTE.length];
    const info = el('span', 'person-info');
    info.append(el('span', 'person-name', displayName(p.name)),
      el('span', 'person-meta', p.profileOnly ? `Voice profile only · ${plural(p.voiceprints, 'sample')}, in no transcript`
        : [plural(p.days.length, 'day'), plural(p.recordings, 'recording'), `${fmtDur(p.seconds)} ${p.tv ? 'heard' : 'talking'}`,
        p.days.length > 1 ? `${shortDate(p.first_seen)} – ${shortDate(p.last_seen)}` : shortDate(p.last_seen)].join(' · ')));
    sum.append(av, info);
    if (p.tv) sum.append(el('span', 'chip tv', 'TV'));
    if (!p.voiceprints && !p.profileOnly) {
      const tag = el('span', 'chip', 'name only'); tag.title = 'Named by you on a day; the voice itself is recognised under another name';
      sum.append(tag);
    }
    c.append(sum);
    c.append(profileSection(p.name, profiles[p.name], p.tv));
    if (p.profileOnly) { frag.append(c); return; }

    // Their own activity grid: darker = more talking that day
    const secs = Object.fromEntries(p.days.map(d => [d.date, Math.max(1, Math.round(d.seconds / 60))]));
    const byDate = Object.fromEntries(p.days.map(d => [d.date, d]));
    const g = heatGrid(secs, {
      title: (k, n) => `${fmtDur(byDate[k].seconds)} talking in ${plural(byDate[k].recordings.length, 'recording')}`,
      onClick: k => go(k), levels: [2, 10, 30],
    });
    c.append(g.wrap);
    const foot = el('div', 'heat-foot');
    foot.append(el('span', null, `Seen on ${plural(g.days, 'day')} in the last year · longest run ${plural(g.best, 'day')}`), heatLegend());
    c.append(foot);

    // Every recording they're in, newest day first
    const list = el('div', 'person-days');
    for (const d of p.days) {
      const row = el('div', 'pday');
      const dl = el('button', 'pday-date', shortDate(d.date)); dl.title = `Open ${longDate(d.date)}`;
      dl.onclick = () => go(d.date);
      const recs = el('div', 'precs');
      for (const r of d.recordings) {
        const b = el('button', 'prec');
        b.append(el('b', null, clock(r.recorded_at) || r.name), el('span', null, ` ${fmtDur(r.seconds)} · ${plural(r.lines, 'line')}`));
        b.title = `Open ${shortDate(d.date)} at ${displayName(p.name)}’s first line in this recording`;
        b.onclick = () => go(d.date, r.first_line);
        recs.append(b);
      }
      row.append(dl, recs);
      list.append(row);
    }
    c.append(list);
    if (p.highlights?.length) {
      const notes = el('div', 'person-notes');
      notes.append(el('h4', null, 'Recently'));
      for (const h of p.highlights) {
        const row = el('div', 'pnote');
        row.append(el('span', `ov-kind k-${h.kind}`, KINDS[h.kind] || h.kind), el('span', null, h.text));
        const b = el('button', 'prec', `${shortDate(h.date)}${h.at ? ' · ' + h.at : ''}`);
        b.title = 'Hear this moment'; b.onclick = () => go(h.date, h.start);
        row.append(b); notes.append(row);
      }
      c.append(notes);
    }
    frag.append(c);
  };
  section(humans, tv.length ? `People · ${humans.length}` : '');
  section(tv, `TV / YouTube · ${tv.length}`);
  $('home-inner').replaceChildren(frag);
  if (focus) requestAnimationFrame(() => [...document.querySelectorAll<HTMLDetailsElement>('.person')].find(x => x.open)?.scrollIntoView({ block: 'start' }));
}
