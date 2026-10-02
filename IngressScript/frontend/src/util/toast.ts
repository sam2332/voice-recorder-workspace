// The little message at the bottom (optionally with an Undo button).
import { $ } from '../core/dom';
import { el } from './elements';

let toastTimer;
// toast('Saved') or toast('Line removed', { action: 'Undo', onAction: fn })
export const toast = (msg: string, opts: { action?: string; onAction?: () => void } = {}) => {
  const t = $('toast');
  t.replaceChildren(el('span', null, msg));
  t.classList.toggle('has-action', !!opts.action);
  if (opts.action) {
    const b = el('button', null, opts.action);
    b.onclick = () => { t.classList.remove('show'); opts.onAction(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), opts.action ? 6000 : 2800);
};
