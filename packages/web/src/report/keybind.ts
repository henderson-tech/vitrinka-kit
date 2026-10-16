/**
 * The reporter's own shortcut for Report a problem (QA Studio assumptions:
 * the snap HotKeyRecorder rules). There is no default: the person records
 * one in the widget's settings by pressing it. The next key pressed with a
 * modifier becomes the shortcut; Esc on its own cancels; a bare key is
 * refused with the reason — and so is Shift alone, which in a browser types
 * capitals. Matched by physical key (`code`: ⌥ rewrites `key` on a Mac).
 * Stored in ONE key of the recorder storage (`vitrinka.recorder.report.keybind`
 * in localStorage); every tab hears a change.
 */
import { getRecorderStorage } from '../recorder/storage';

export interface Keybind {
  code: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/** What a keydown means while the settings record a shortcut. */
export type KeybindVerdict = { kind: 'cancel' } | { kind: 'wait' } | { kind: 'bare' } | { kind: 'bind'; bind: Keybind };

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'OS', 'CapsLock', 'Fn', 'Hyper', 'Super']);

export const KEYBIND_STORAGE_KEY = 'report.keybind';

export function readKeybindPress(e: KeyPress): KeybindVerdict {
  if (MODIFIER_KEYS.has(e.key)) return { kind: 'wait' };
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return { kind: 'cancel' };
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return { kind: 'bare' };
  return { kind: 'bind', bind: { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey } };
}

export function matchesKeybind(e: KeyPress, b: Keybind): boolean {
  return e.code === b.code && e.altKey === b.alt && e.ctrlKey === b.ctrl && e.metaKey === b.meta && e.shiftKey === b.shift;
}

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: '↵',
  Backspace: '⌫',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Slash: '/',
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1]!;
  return NAMED[code] ?? code;
}

export function isMacPlatform(): boolean {
  const nav = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  const platform = nav?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac|iphone|ipad/i.test(platform);
}

/** ⌃⌥⇧⌘R on a Mac, Ctrl+Alt+Shift+R elsewhere. */
export function keybindLabel(b: Keybind, mac = isMacPlatform()): string {
  const key = keyLabel(b.code);
  if (mac) return `${b.ctrl ? '⌃' : ''}${b.alt ? '⌥' : ''}${b.shift ? '⇧' : ''}${b.meta ? '⌘' : ''}${key}`;
  return [b.ctrl && 'Ctrl', b.alt && 'Alt', b.shift && 'Shift', b.meta && 'Meta', key].filter(Boolean).join('+');
}

function parseKeybind(raw: string | null | undefined): Keybind | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const b = v as Record<string, unknown>;
    if (typeof b.code !== 'string' || !b.code) return null;
    const bind: Keybind = { code: b.code, alt: b.alt === true, ctrl: b.ctrl === true, meta: b.meta === true, shift: b.shift === true };
    return bind.alt || bind.ctrl || bind.meta ? bind : null;
  } catch {
    return null;
  }
}

export function loadKeybind(): Keybind | null {
  return parseKeybind(getRecorderStorage().getString(KEYBIND_STORAGE_KEY));
}

export function saveKeybind(b: Keybind | null): void {
  const s = getRecorderStorage();
  if (b) s.set(KEYBIND_STORAGE_KEY, JSON.stringify(b));
  else s.remove(KEYBIND_STORAGE_KEY);
}

/** Hear another tab change the shortcut; returns the unsubscribe. */
export function watchKeybind(on: (b: Keybind | null) => void): () => void {
  const s = getRecorderStorage();
  return s.watch ? s.watch(KEYBIND_STORAGE_KEY, (v) => on(parseKeybind(v))) : () => undefined;
}
