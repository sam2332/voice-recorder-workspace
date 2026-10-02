// Side drawers on narrow screens.
import { $ } from './core/dom';

export function openDrawer(id) {
  const d = $(id), open = !d.classList.contains('open');
  closeDrawers();
  if (open) { d.classList.add('open'); $('scrim').classList.remove('hidden'); }
}
export function closeDrawers() {
  ['library', 'details'].forEach(id => $(id).classList.remove('open'));
  $('scrim').classList.add('hidden');
}
