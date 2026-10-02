/**
 * How an element is named in a click or an annotation — DOM reads only, so
 * the HUD (annotate mode) can share them without the capture queue.
 */

const TEXT_CAP = 80;

/** The extension's selector heuristic — id, then testid, then a short path. */
export function shortSelector(el: Element | null): string {
  if (!el) return '';
  if (el.id) return `#${el.id}`;
  const t = el.getAttribute('data-testid') || el.getAttribute('data-test');
  if (t) return `[data-testid="${t}"]`;
  const parts: string[] = [];
  let n: Element | null = el;
  while (n && parts.length < 4) {
    let p = n.tagName.toLowerCase();
    if (n.classList.length) p += '.' + [...n.classList].slice(0, 2).join('.');
    parts.unshift(p);
    if (n.id) {
      parts[0] = `#${n.id}`;
      break;
    }
    n = n.parentElement;
  }
  return parts.join(' > ');
}

/** The element's own visible text or value, trimmed and capped. */
export function elementText(el: Element): string {
  const html = el as HTMLElement & { value?: unknown };
  const raw = html.innerText || (typeof html.value === 'string' ? html.value : '') || '';
  return raw.trim().slice(0, TEXT_CAP);
}
