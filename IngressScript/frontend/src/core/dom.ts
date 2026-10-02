// The one-line $() lookup, the main <audio> and shared constants.

/** An element found by id. The id can't tell TypeScript which kind it is, so it carries the input, select,
 * dialog and media members the page uses. Pass a type to narrow it: $<HTMLCanvasElement>('wave'). */
export type AnyEl = HTMLInputElement & Omit<HTMLSelectElement, 'type'> & HTMLDialogElement & HTMLAudioElement;
export const $ = <T extends HTMLElement = AnyEl>(id: string): T => document.getElementById(id) as T;
export const audio = $<HTMLAudioElement>('audio');
export const PALETTE = ['#3b6fe0', '#d9534f', '#2a9d6f', '#c97b18', '#8e5bd6', '#d6488f', '#1f9bb3', '#7a8a1f', '#a0522d', '#5865a8'];
export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
export const ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spin: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
};
