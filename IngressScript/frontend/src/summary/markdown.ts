// A tiny Markdown-to-DOM renderer for summaries.
import { state } from '../core/state';
import { clockAt } from '../day/helpers';
import { go } from '../library/library';
import { seek } from '../player/audio';
import { el } from '../util/elements';
import { fmt, shortDate } from '../util/format';
import { store } from '../util/store';

// Small, safe Markdown renderer (headings, nested lists, task boxes, bold/italic/code) built as DOM nodes
export function renderMarkdown(md: string, refs, opts: { doneKey?: string } = {}) {
  const root = el('div', 'md');
  const doneKey = opts.doneKey || 'summaryDone:' + state.date;
  const done = new Set(store.get(doneKey, []));
  const inline = (text, into) => {
    const rx = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[L\d+(?:\s*[-–,]\s*L?\d+)*\])/g;
    let pos = 0;
    for (const m of text.matchAll(rx)) {
      into.append(text.slice(pos, m.index));
      const t = m[0];
      if (t.startsWith('**')) into.append(el('strong', null, t.slice(2, -2)));
      else if (t.startsWith('`')) into.append(el('code', null, t.slice(1, -1)));
      else if (t.startsWith('[L')) {
        for (const part of t.slice(1, -1).split(/\s*,\s*/)) {
          // "L30" or a range "L30-L45": the chip plays from the start of it
          const [r, last] = part.split(/\s*[-–]\s*/).map(x => 'L' + x.replace(/^L/, ''));
          const at = refs[r];
          if (at === undefined) continue;   // a tag the model made up: drop it
          // Meeting summaries cite lines from several days: {date, start, at}
          const far = typeof at === 'object';
          const b = el('button', 'ref', far ? `${shortDate(at.date)} ${at.at}` : clockAt(at) || fmt(at));
          b.title = far ? 'Open this moment' : last && refs[last] !== undefined ? `Play from here (${clockAt(at)}–${clockAt(refs[last])})` : 'Play from here';
          b.onclick = far ? () => go(at.date, at.start) : () => { state.userScrolledAt = 0; seek(at, true); };
          into.append(b);
        }
      } else into.append(el('em', null, t.slice(1, -1)));
      pos = m.index + t.length;
    }
    into.append(text.slice(pos));
  };
  const stack: { indent: number; node: HTMLElement; list?: HTMLElement; li?: HTMLElement }[] = [{ indent: -1, node: root }];
  let para = null;
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { para = null; continue; }
    const head = /^(#{1,4})\s+(.*)$/.exec(line.trim());
    const item = /^(\s*)[-*+]\s+(.*)$/.exec(line) || /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (head) {
      stack.length = 1; para = null;
      const hn = el(('h' + Math.min(4, Math.max(2, head[1].length))) as 'h2');   // ## sections, ### items
      inline(head[2].replace(/\s*#+$/, ''), hn);
      root.append(hn);
    } else if (item) {
      para = null;
      const indent = item[1].replace(/\t/g, '  ').length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      let top = stack[stack.length - 1];
      if (!top.list || indent > top.indent) {
        const ul = el('ul');
        (top.li || top.node).append(ul);
        top = { indent, node: ul, list: ul };
        stack.push(top);
      }
      const li = el('li');
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(item[2]);
      if (task) {
        // Shopping list / to-do boxes: ticks are remembered in this browser
        const key = task[2].replace(/\[L[\d, L]+\]/g, '').trim().toLowerCase();
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = task[1] !== ' ' || done.has(key);
        const span = el('span'); inline(task[2], span);
        li.className = 'task' + (cb.checked ? ' done' : '');
        cb.onchange = () => {
          cb.checked ? done.add(key) : done.delete(key);
          store.set(doneKey, [...done]);
          li.classList.toggle('done', cb.checked);
        };
        li.append(cb, span);
      } else inline(item[2], li);
      top.list.append(li);
      top.li = li;
    } else {
      stack.length = 1;
      if (!para) { para = el('p'); root.append(para); } else para.append(' ');
      inline(line.trim(), para);
    }
  }
  return root;
}
