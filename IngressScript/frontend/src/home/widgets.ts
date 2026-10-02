// Small building blocks of the Home page.
import { state } from '../core/state';
import { settingsForm } from './settings';
import { el, svg } from '../util/elements';

export const HOME_ICONS = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/>',
  usb: '<path d="M10 7V3h4v4"/><rect x="7" y="7" width="10" height="14" rx="2"/><path d="M10 11h4"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
};

export function card(icon, title, cls = '') {
  const c = el('section', 'card ' + cls);
  const h = el('h3'); h.append(svg(HOME_ICONS[icon]), el('span', null, title));
  c.append(h);
  return c;
}
export function btn(label, cls, onclick) { const b = el('button', 'btn ' + cls, label); b.onclick = onclick; return b; }
export function progressBar(frac, left, right) {
  const p = el('div', 'progress');
  const bar = el('div', 'bar' + (frac ? '' : ' indeterminate')); const fill = el('i'); fill.style.width = `${(frac || 0) * 100}%`; bar.append(fill);
  const lbl = el('div', 'lbl'); lbl.append(el('span', null, left), el('span', null, right || ''));
  p.append(bar, lbl);
  return p;
}

export function checksList() {
  const ul = el('ul', 'checks');
  const names = { hf: 'Speaker detection models (Hugging Face)', ffmpeg: 'Audio tools (ffmpeg)', gpu: 'Graphics card', record_dir: 'Recordings folder' };
  for (const [k, label] of Object.entries(names)) {
    const c = state.checks?.[k]; if (!c) continue;
    const li = el('li');
    const icon = el('span', c.ok ? 'ok' : 'bad'); icon.append(svg(c.ok ? HOME_ICONS.check : HOME_ICONS.alert)); (icon.firstChild as SVGElement).style.width = '18px';
    const txt = el('div'); txt.append(el('div', null, label), el('div', 'd', c.detail));
    li.append(icon, txt); ul.append(li);
  }
  return ul;
}

// Forms are reused between refreshes so half-made choices aren't wiped by the 5-second poll
export function cachedForm(kind, onSave, label) {
  const key = JSON.stringify(state.settings);
  state.forms = state.forms || {};
  if (state.forms[kind]?.key !== key) state.forms[kind] = { key, node: settingsForm(onSave, label) };
  return state.forms[kind].node;
}
