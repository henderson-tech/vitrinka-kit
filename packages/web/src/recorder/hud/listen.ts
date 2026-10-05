/**
 * `listen` — the ONE way the HUD registers a window/document listener that
 * cancels its event (`preventDefault`). It is always `{ passive: false }` and
 * always the browser's own registration, never a host's patched one.
 *
 * Why not plain `addEventListener(…, { passive: false })`: zone.js (every
 * Angular host) patches `addEventListener` and funnels every listener of one
 * target + type + phase through ONE native listener, registered with the
 * options of whoever came FIRST. Angular CDK's InputModalityDetector registers
 * `keydown`, `mousedown` and `touchstart` on document `{ passive: true,
 * capture: true }` at boot, so the HUD's Esc handler ran inside a passive
 * invocation: Chrome logged "Unable to preventDefault inside passive event
 * listener invocation" and the default went ahead anyway. zone.js keeps the
 * unpatched functions under `__zone_symbol__addEventListener` /
 * `__zone_symbol__removeEventListener`; registering through them gives the
 * handler its own native listener with its own options (and keeps the HUD's
 * pointer traffic out of the host's change detection).
 */

type Add = EventTarget['addEventListener'];
type Remove = EventTarget['removeEventListener'];

/** What zone.js leaves on a patched EventTarget: the native functions. */
interface ZonePatched {
  __zone_symbol__addEventListener?: Add;
  __zone_symbol__removeEventListener?: Remove;
}

export interface ListenOptions {
  capture?: boolean;
}

export function listen<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: ListenOptions): () => void;
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  fn: (e: DocumentEventMap[K]) => void,
  opts?: ListenOptions,
): () => void;
export function listen(target: EventTarget, type: string, fn: (e: Event) => void, opts?: ListenOptions): () => void;
/** Register a cancelling listener natively and non-passive; returns its remover. */
export function listen(target: EventTarget, type: string, fn: (e: Event) => void, opts: ListenOptions = {}): () => void {
  const zone = target as EventTarget & ZonePatched;
  const add = zone.__zone_symbol__addEventListener ?? target.addEventListener;
  const remove = zone.__zone_symbol__removeEventListener ?? target.removeEventListener;
  const capture = opts.capture ?? false;
  add.call(target, type, fn, { capture, passive: false });
  return () => remove.call(target, type, fn, capture);
}
