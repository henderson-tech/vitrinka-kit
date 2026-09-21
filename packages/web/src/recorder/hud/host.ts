/**
 * The HUD host (D4): one element appended to `document.documentElement`,
 * carrying an OPEN shadow root the React HUD renders into. `popover="manual"`
 * where supported so it paints in the top layer above every page z-index;
 * a MutationObserver re-raises it whenever a dialog opens or closes, so it
 * stays above a later top-layer entrant.
 *
 * The propagation SHIELD: nothing the tester does on the HUD reaches the host
 * page. Shadow retargeting makes every event look like it happened on the
 * host element, and a page's "close on outside pointerdown / focus" logic
 * would close the very dialog being reported. Bubble-phase stops on the host
 * — no preventDefault, so buttons and the textarea still focus.
 */
import { RRWEB_BLOCK_ATTR } from '../capture/rrweb';
import { HOST_STYLE, SHEET_HOST_STYLE } from './styles';

const SHIELDED = [
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointercancel',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'click', 'dblclick', 'auxclick',
  'contextmenu', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'wheel',
  'focusin', 'focusout', 'keydown', 'keyup', 'keypress',
] as const;

export function shield(el: HTMLElement): void {
  for (const t of SHIELDED) el.addEventListener(t, (e) => e.stopPropagation());
}

export interface HudHost {
  host: HTMLElement;
  /** The React mount point inside the shadow root. */
  mount: HTMLElement;
  /** True while a modal/dialog is open — the sheet portals into it. */
  destroy: () => void;
}

type PopoverEl = HTMLElement & { popover?: string; showPopover?: () => void; hidePopover?: () => void };

export function createHudHost(): HudHost {
  const host = document.createElement('div') as PopoverEl;
  host.setAttribute(RRWEB_BLOCK_ATTR, '');
  host.setAttribute('data-vitrinka-hud', '');
  host.style.cssText = HOST_STYLE;
  const root = host.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  root.append(mount);
  shield(host);
  document.documentElement.append(host);

  const canPop = typeof host.showPopover === 'function';
  const raise = () => {
    if (!canPop || !host.isConnected) return;
    try {
      host.hidePopover?.();
    } catch {
      // not shown
    }
    try {
      host.showPopover?.();
    } catch {
      // detached
    }
  };
  if (canPop) host.popover = 'manual';
  raise();

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      raise();
    });
  };
  const touchesDialog = (m: MutationRecord): boolean => {
    if (m.type === 'attributes') return m.target instanceof Element && isDialog(m.target);
    for (const list of [m.addedNodes, m.removedNodes]) {
      for (const n of list) {
        if (n instanceof Element && (isDialog(n) || n.querySelector(DIALOG_SEL))) return true;
      }
    }
    return false;
  };
  const mo = new MutationObserver((muts) => {
    if (muts.some(touchesDialog)) schedule();
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'data-state'],
  });

  return {
    host,
    mount,
    destroy: () => {
      mo.disconnect();
      try {
        host.hidePopover?.();
      } catch {
        // not shown
      }
      host.remove();
    },
  };
}

const DIALOG_SEL = 'dialog,[role="dialog"]';

function isDialog(el: Element): boolean {
  return el.matches(DIALOG_SEL);
}

/**
 * Where the composer sheet portals (D4): the topmost open `<dialog>` (last in
 * document order), else the last open ARIA dialog (`[role="dialog"]
 * [data-state="open"]` — Radix and friends), else null = the HUD host itself.
 * Inside the dialog's subtree a focus trap and a modal's inert both leave
 * the sheet alone.
 */
export function sheetTarget(): Element | null {
  const native = document.querySelectorAll('dialog[open]');
  const lastNative = native[native.length - 1];
  if (lastNative) return lastNative;
  const aria = document.querySelectorAll('[role="dialog"][data-state="open"]');
  return aria[aria.length - 1] ?? null;
}

/**
 * A sheet host: its own open shadow root (so the HUD stylesheet applies
 * inside a foreign dialog too), shielded, appended to `target`.
 */
export function createSheetHost(target: Element): { mount: HTMLElement; destroy: () => void } {
  const el = document.createElement('div');
  el.setAttribute(RRWEB_BLOCK_ATTR, '');
  el.setAttribute('data-vitrinka-sheet', '');
  el.style.cssText = SHEET_HOST_STYLE;
  const root = el.attachShadow({ mode: 'open' });
  const mount = document.createElement('div');
  root.append(mount);
  shield(el);
  target.append(el);
  return { mount, destroy: () => el.remove() };
}

/** Is `t` inside any HUD surface (host or a portaled sheet)? */
export function insideHud(t: EventTarget | null): boolean {
  if (!(t instanceof Node)) return false;
  const el = t instanceof Element ? t : t.parentElement;
  return Boolean(el?.closest('[data-vitrinka-hud],[data-vitrinka-sheet]'));
}
