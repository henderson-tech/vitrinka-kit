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
import { RRWEB_BLOCK_ATTR } from '../block';
import { HOST_STYLE, SHEET_HOST_STYLE } from './host-style';
import { listen } from './listen';

const SHIELDED = [
  'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointercancel',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'click', 'dblclick', 'auxclick',
  'contextmenu', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'wheel',
  'focusin', 'focusout', 'keydown', 'keyup', 'keypress',
  // An image pasted or dropped onto a sheet is the HUD's, never the page's upload.
  'paste', 'dragenter', 'dragover', 'dragleave', 'drop',
] as const;

export function shield(el: HTMLElement): void {
  for (const t of SHIELDED) el.addEventListener(t, (e) => e.stopPropagation());
}

/**
 * The KEY GUARD (vt-8020 S14): the bubble-phase shield above comes too late
 * for a host that listens in the CAPTURE phase on window or document (the
 * PWF designer's BPMN modeler binds 'e' that way) — and shadow retargeting
 * shows that listener our host element as `event.target`, never the field,
 * so its "ignore keys while typing" check fails and typing 'e' in a note
 * fires the host's tool. One window capture listener runs ahead of every
 * document- and element-level one: a key typed into one of our fields stops
 * there. Text still lands — stopping propagation never cancels the default
 * action — and Enter, Escape and Tab pass untouched, so the widgets' own
 * handlers (send, close, focus order) keep working; so do chords with
 * Ctrl/⌘/Alt that are not text editing (the reporter's shortcut, the pill's
 * ⌥⇧ chords). A window capture listener the page registered BEFORE the first
 * host still runs first: nothing can precede it.
 */
const GUARDED = ['keydown', 'keyup', 'keypress'] as const;
const HOST_DATA = ['vitrinkaHud', 'vitrinkaSheet'] as const;
/** Moving the caret or deleting, on their own or with a modifier (word and line steps). */
const CARET_KEYS = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
/** ⌘/Ctrl + these are the field's own editing (select all, copy, cut, paste, undo, redo) — a host's would act on its canvas instead. */
const EDIT_CODES = new Set(['KeyA', 'KeyC', 'KeyX', 'KeyV', 'KeyZ', 'KeyY']);
/** Input types a person types text into; a checkbox's Space is not typing. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

export interface GuardedKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  getModifierState?: (key: string) => boolean;
  composedPath: () => readonly unknown[];
}

/** A key that edits text: a character, the caret and delete keys, or a text-editing chord. Enter, Escape and Tab never are. */
export function typingKey(e: Omit<GuardedKey, 'composedPath'>): boolean {
  const char = e.key.length === 1;
  // AltGr (Ctrl+Alt on Windows) types @, {, € on Czech and other layouts.
  if (char && e.getModifierState?.('AltGraph')) return true;
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return char || CARET_KEYS.has(e.key);
  if (CARET_KEYS.has(e.key)) return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && EDIT_CODES.has(e.code);
}

function editable(n: unknown): boolean {
  if (typeof n !== 'object' || n === null) return false;
  if ('isContentEditable' in n && n.isContentEditable === true) return true;
  const tag = 'tagName' in n && typeof n.tagName === 'string' ? n.tagName : '';
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && 'type' in n && typeof n.type === 'string' && TEXT_INPUTS.has(n.type);
}

function ourHost(n: unknown): boolean {
  if (typeof n !== 'object' || n === null || !('dataset' in n)) return false;
  const data = n.dataset;
  return typeof data === 'object' && data !== null && HOST_DATA.some((k) => k in data);
}

/** The guard's whole rule: a typing key whose real target (`composedPath()[0]`) is a text field inside a HUD or sheet host. */
export function guardsKey(e: GuardedKey): boolean {
  if (!typingKey(e)) return false;
  const path = e.composedPath();
  return editable(path[0]) && path.some(ourHost);
}

let guardHolders = 0;
let unguard: (() => void) | null = null;

/** Installs the page's one key guard with the first host; the last host's release removes it. */
function holdKeyGuard(): () => void {
  guardHolders++;
  if (!unguard && typeof window !== 'undefined') {
    const guard = (e: KeyboardEvent) => {
      if (guardsKey(e)) e.stopImmediatePropagation();
    };
    const offs = GUARDED.map((t) => listen(window, t, guard, { capture: true }));
    unguard = () => {
      for (const off of offs) off();
    };
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--guardHolders > 0) return;
    unguard?.();
    unguard = null;
  };
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
  const releaseGuard = holdKeyGuard();
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
  // A dialog can mount anywhere in the tree, so the whole document is watched
  // — but the WORK is kept off the mutation hot path: records are collected
  // and inspected at most once per animation frame, text nodes and childless
  // elements are dismissed without a query, and the first hit ends the scan.
  // Attribute records are already narrowed by attributeFilter.
  const touchesDialog = (m: MutationRecord): boolean => {
    if (m.type === 'attributes') return m.target instanceof Element && isDialog(m.target);
    for (const list of [m.addedNodes, m.removedNodes]) {
      for (const n of list) {
        if (!(n instanceof Element)) continue;
        if (isDialog(n)) return true;
        if (n.childElementCount > 0 && n.querySelector(DIALOG_SEL)) return true;
      }
    }
    return false;
  };
  let pending: MutationRecord[] = [];
  let scanRaf = 0;
  const scan = () => {
    scanRaf = 0;
    const batch = pending;
    pending = [];
    if (batch.some(touchesDialog)) schedule();
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) pending.push(m);
    if (scanRaf === 0) {
      scanRaf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(scan)
          : (setTimeout(scan, 16) as unknown as number);
    }
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
      releaseGuard();
      mo.disconnect();
      if (scanRaf !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scanRaf);
      pending = [];
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
  const releaseGuard = holdKeyGuard();
  target.append(el);
  return {
    mount,
    destroy: () => {
      releaseGuard();
      el.remove();
    },
  };
}

/** Is `t` inside any HUD surface (host or a portaled sheet)? */
export function insideHud(t: EventTarget | null): boolean {
  if (!(t instanceof Node)) return false;
  const el = t instanceof Element ? t : t.parentElement;
  return Boolean(el?.closest('[data-vitrinka-hud],[data-vitrinka-sheet]'));
}
