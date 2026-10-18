/**
 * The key guard (hud/host.ts, vt-8020 S14): a typing key whose real target
 * is a text field inside one of our hosts stops at window capture, so a host
 * page's capture-phase shortcut never hears it; Enter, Escape, Tab and
 * non-editing chords pass, and so does anything typed outside our hosts.
 */
import { describe, expect, it } from 'bun:test';

import { type GuardedKey, guardsKey, typingKey } from '../hud/host';

const HUD = { dataset: { vitrinkaHud: '' } };
const SHEET = { dataset: { vitrinkaSheet: '' } };
const TEXTAREA = { tagName: 'TEXTAREA', dataset: {} };
const NOTE = { tagName: 'INPUT', type: 'text', dataset: {} };
const CHECKBOX = { tagName: 'INPUT', type: 'checkbox', dataset: {} };
const BUTTON = { tagName: 'BUTTON', dataset: {} };

function key(k: string, path: readonly unknown[] = [TEXTAREA, HUD], mods: Partial<Pick<GuardedKey, 'altKey' | 'ctrlKey' | 'metaKey'>> & { code?: string; altGraph?: boolean } = {}): GuardedKey {
  return {
    key: k,
    code: mods.code ?? '',
    altKey: mods.altKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    getModifierState: (m) => m === 'AltGraph' && mods.altGraph === true,
    composedPath: () => path,
  };
}

describe('typingKey', () => {
  it('takes characters, Space, the caret and delete keys; never Enter, Escape or Tab', () => {
    for (const k of ['e', 'E', 'ř', ' ', '1', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) expect(typingKey(key(k))).toBe(true);
    for (const k of ['Enter', 'Escape', 'Tab', 'F2', 'Shift']) expect(typingKey(key(k))).toBe(false);
  });

  it('takes the field’s own editing chords and AltGr characters, never another chord', () => {
    expect(typingKey(key('v', [], { metaKey: true, code: 'KeyV' }))).toBe(true);
    expect(typingKey(key('z', [], { ctrlKey: true, code: 'KeyZ' }))).toBe(true);
    expect(typingKey(key('ArrowLeft', [], { altKey: true }))).toBe(true);
    expect(typingKey(key('@', [], { ctrlKey: true, altKey: true, code: 'KeyV', altGraph: true }))).toBe(true);
    // The reporter's shortcut and the pill's ⌥⇧ chords keep reaching their window listeners.
    expect(typingKey(key('R', [], { altKey: true, code: 'KeyR' }))).toBe(false);
    expect(typingKey(key('k', [], { metaKey: true, code: 'KeyK' }))).toBe(false);
    expect(typingKey(key('v', [], { ctrlKey: true, altKey: true, code: 'KeyV' }))).toBe(false);
  });
});

describe('guardsKey', () => {
  it('guards a key typed into a field inside the HUD or a sheet host', () => {
    expect(guardsKey(key('e', [TEXTAREA, HUD]))).toBe(true);
    expect(guardsKey(key('e', [NOTE, { dataset: {} }, SHEET]))).toBe(true);
    expect(guardsKey(key('e', [{ isContentEditable: true, dataset: {} }, HUD]))).toBe(true);
  });

  it('lets the page have keys typed outside our hosts, on our buttons and checkboxes', () => {
    expect(guardsKey(key('e', [TEXTAREA, { dataset: {} }]))).toBe(false);
    expect(guardsKey(key('e', [BUTTON, HUD]))).toBe(false);
    expect(guardsKey(key(' ', [CHECKBOX, HUD]))).toBe(false);
    expect(guardsKey(key('Escape', [TEXTAREA, HUD]))).toBe(false);
  });
});
