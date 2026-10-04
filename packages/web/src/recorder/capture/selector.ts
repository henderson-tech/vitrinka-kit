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

/** Form fields: rrweb masks every input value, so their text is never read. */
const FORM_FIELD = 'input,textarea,select';

/** What the DOM lane already hides — rrweb's mask and block classes. */
const MASKED = '.rr-mask,.rr-block';

/**
 * The element's own visible text, trimmed and capped — never more than the
 * DOM lane shows. Never a form field's value or text (rrweb masks every
 * input, so a click on a filled password field must not record it), and ''
 * for an element at, under or around `.rr-mask` / `.rr-block`: `innerText`
 * of a wrapper would carry its masked child's text.
 */
export function elementText(el: Element): string {
  if (el.matches(FORM_FIELD) || el.closest(MASKED) || el.querySelector(MASKED)) return '';
  return ((el as HTMLElement).innerText || '').trim().slice(0, TEXT_CAP);
}
