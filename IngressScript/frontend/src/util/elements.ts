// Building DOM nodes and inline SVG icons.

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string | null, text?: string | number | null): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
};
export const svg = (paths: string, cls?: string): SVGSVGElement => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = paths;
  return s;
};
