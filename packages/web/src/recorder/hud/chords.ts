/**
 * The recorder shortcuts: ⌥⇧A annotate · ⌥⇧N note · ⌥⇧P pause · ⌥⇧S stop.
 *
 * Only the LEADER's HUD binds them (ONE recorder D9): a keydown on `window`
 * reaches the listeners of the page's world and the extension's alike, so a
 * follower that bound them too would act twice. Untrusted (synthetic)
 * keydowns are taken on purpose: Chrome hands the extension's command chords
 * to its worker, never to the page, and the worker relays them as a
 * synthetic keydown — `isTrusted: false` (D10). A taken chord is
 * `preventDefault`ed, never stopped, so a host that skips `defaultPrevented`
 * keys (forge-studio's CommandProvider) leaves it alone.
 */
import { listen } from './listen';

export type Chord = 'annotate' | 'note' | 'pause' | 'stop';

export type ChordKey = Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'code'>;

const BY_CODE: Readonly<Record<string, Chord>> = { KeyA: 'annotate', KeyN: 'note', KeyP: 'pause', KeyS: 'stop' };

/** The chord a keydown is, by its physical key (⌥ rewrites `key` on a Mac); null for anything else. */
export function chordOf(e: ChordKey): Chord | null {
  if (!e.altKey || !e.shiftKey || e.metaKey || e.ctrlKey) return null;
  return BY_CODE[e.code] ?? null;
}

/**
 * Bind the chords on `target` (window), capture phase — the host's shield
 * stops a keydown from a focused HUD control before it could bubble there,
 * and a drag leaves the handle focused. Returns the unbind.
 */
export function bindChords(target: EventTarget, on: (c: Chord) => void): () => void {
  return listen(
    target,
    'keydown',
    (e) => {
      const c = chordOf(e as KeyboardEvent);
      if (!c) return;
      on(c);
      e.preventDefault();
    },
    { capture: true },
  );
}
