/**
 * Click lane — a capture-phase document listener (sees clicks the app
 * swallows). Shape matches the extension's content script exactly:
 * `{selector, text, rect}` — `shortSelector` (id > data-testid > a ≤4-hop
 * tag.class path), the element's text (`clickText`: redacted, 80 chars,
 * never more than the DOM lane shows) and its bounding rect in device pixels
 * — plus `route`.
 */
import { pushEvent } from '../queue';
import { currentRoute } from '../state';
import { maskDirectives, redactText } from './redact';
import { elementText, shortSelector } from './selector';

export { elementText, shortSelector };

const CLICKABLE = 'a,button,[role=button],input,select,textarea,label';

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

/**
 * A click's `text` under the active rules: '' when a `maskAllText` policy
 * has rrweb mask every text node, otherwise `elementText` (no form-field
 * values, nothing rr-masked) through the free-text scrub.
 */
export function clickText(el: Element): string {
  if (maskDirectives().maskAllText) return '';
  return redactText(elementText(el)) ?? '';
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
          text: clickText(el),
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
