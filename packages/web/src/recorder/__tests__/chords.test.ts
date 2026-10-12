/**
 * The recorder chords (hud/chords.ts): the extension relays its command
 * chords as a SYNTHETIC keydown on `window` (ONE recorder D10), so the
 * leader's HUD must act on `isTrusted: false` — and take the key with
 * `preventDefault` only, never stopping it (a host skipping
 * `defaultPrevented` keys leaves it alone).
 */
import { describe, expect, it } from 'bun:test';

import { bindChords, type Chord, chordOf } from '../hud/chords';

/** A script-dispatched keydown, as `chord()` in the extension's content script makes one. */
function keydown(code: string, mods: { alt?: boolean; shift?: boolean; meta?: boolean; ctrl?: boolean } = { alt: true, shift: true }): Event {
  const e = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    code: { value: code },
    altKey: { value: mods.alt === true },
    shiftKey: { value: mods.shift === true },
    metaKey: { value: mods.meta === true },
    ctrlKey: { value: mods.ctrl === true },
  });
  return e;
}

describe('chords', () => {
  it('⌥⇧A/N/P/S by physical key; anything else, or another modifier, is not a chord', () => {
    const k = (code: string, mods?: Parameters<typeof keydown>[1]) => chordOf(keydown(code, mods) as KeyboardEvent);
    expect([k('KeyA'), k('KeyN'), k('KeyP'), k('KeyS')]).toEqual(['annotate', 'note', 'pause', 'stop']);
    expect(k('KeyB')).toBeNull();
    expect(k('KeyN', { alt: true })).toBeNull();
    expect(k('KeyN', { alt: true, shift: true, meta: true })).toBeNull();
    expect(k('KeyN', { alt: true, shift: true, ctrl: true })).toBeNull();
  });

  it('acts on an untrusted (relayed) chord, prevents its default and lets it propagate', () => {
    const win = new EventTarget();
    const heard: Chord[] = [];
    const off = bindChords(win, (c) => heard.push(c));
    let reachedPage = false;
    win.addEventListener('keydown', () => {
      reachedPage = true;
    });
    const relayed = keydown('KeyN');
    expect(relayed.isTrusted).toBe(false);
    win.dispatchEvent(relayed);
    expect(heard).toEqual(['note']);
    expect(relayed.defaultPrevented).toBe(true);
    expect(reachedPage).toBe(true);
    const other = keydown('KeyQ');
    win.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    off();
    win.dispatchEvent(keydown('KeyS'));
    expect(heard).toEqual(['note']);
  });
});
