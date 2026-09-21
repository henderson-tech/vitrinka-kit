/**
 * Click lane — a capture-phase document listener (sees clicks the app
 * swallows). Shape matches the extension's content script exactly:
 * `{selector, text, rect}` — `shortSelector` (id > data-testid > a ≤4-hop
 * tag.class path), the element's text (redacted, 80 chars) and its bounding
 * rect in device pixels — plus `route`.
 */
import { pushEvent } from '../queue';
import { currentRoute } from '../state';
import { redactText } from './redact';

const TEXT_CAP = 80;
const CLICKABLE = 'a,button,[role=button],input,select,textarea,label';

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

/** Bounding rect in device pixels (the extension's `imageRect`). */
export function imageRect(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  const s = globalThis.devicePixelRatio || 1;
  return {
    x: Math.round(r.x * s),
    y: Math.round(r.y * s),
    w: Math.round(r.width * s),
    h: Math.round(r.height * s),
  };
}

/** The element's own visible text or value, trimmed and capped. */
export function elementText(el: Element): string {
  const html = el as HTMLElement & { value?: unknown };
  const raw = html.innerText || (typeof html.value === 'string' ? html.value : '') || '';
  return raw.trim().slice(0, TEXT_CAP);
}

export interface ClickLaneOptions {
  /** True while the HUD owns the pointer (annotate mode) or the target is HUD chrome. */
  ignore: (target: EventTarget | null) => boolean;
}

/** Install the click lane; returns the uninstaller. */
export function installClickLane(opts: ClickLaneOptions): () => void {
  const onClick = (e: MouseEvent) => {
    try {
      if (opts.ignore(e.target)) return;
      const target = e.target instanceof Element ? e.target : null;
      const el = target ? target.closest(CLICKABLE) || target : null;
      if (!el) return;
      pushEvent(
        'click',
        {
          selector: shortSelector(el),
          text: redactText(elementText(el)) ?? '',
          rect: imageRect(el),
          route: currentRoute.pathname,
        },
        { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost },
      );
    } catch {
      // capture must never break the click
    }
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
