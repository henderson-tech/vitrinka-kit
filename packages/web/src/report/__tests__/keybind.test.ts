/**
 * The reporter's shortcut (vt-8020): ⌥⇧A until the person records another or
 * removes it — and a removed shortcut stays removed.
 */
import { describe, expect, it } from 'bun:test';

import { DEFAULT_KEYBIND, keybindLabel, resolveKeybind } from '../keybind';

describe('resolveKeybind', () => {
  it('answers ⌥⇧A when nothing is stored, or what is stored cannot be read', () => {
    expect(resolveKeybind(null)).toEqual(DEFAULT_KEYBIND);
    expect(resolveKeybind('{not json')).toEqual(DEFAULT_KEYBIND);
  });

  it('keeps a removed shortcut removed', () => {
    expect(resolveKeybind('off')).toBeNull();
  });

  it('answers the shortcut the person recorded', () => {
    const own = { code: 'KeyR', alt: false, ctrl: true, meta: false, shift: true };
    expect(resolveKeybind(JSON.stringify(own))).toEqual(own);
  });

  it('names the default the way each platform writes it', () => {
    expect(keybindLabel(DEFAULT_KEYBIND, true)).toBe('⌥⇧A');
    expect(keybindLabel(DEFAULT_KEYBIND, false)).toBe('Alt+Shift+A');
  });
});
