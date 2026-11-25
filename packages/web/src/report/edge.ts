/**
 * The edge drop (vt-3811): the default launcher rests on the right edge of the
 * viewport, a little below the middle, and slides up or down along it — never
 * off it. Its place is a fraction of the band it may use (0 = the top of the
 * band, 1 = the bottom), so it lands in the same proportion when the window
 * changes height; the band keeps clear of a page's top bar and its bottom bars
 * (an order bar, a phone's tab dock). The fraction is remembered per origin.
 *
 * The card opens beside the drop, toward the middle of the page, centred on
 * it and kept inside the viewport.
 */
import type { Corner } from './place';
import { readPref, writePref } from './settings';

export type Launcher = 'edge' | 'corner';

export const EDGE_KEY = 'vitrinka.report.edge';
/** A little below the middle: under the content people read, above the bottom bars. */
export const EDGE_DEFAULT = 0.62;
/** Alt+↑/↓ moves the drop by this share of its band. */
export const EDGE_STEP = 0.1;

/** The clear space the drop keeps at the top and the bottom of the viewport, in CSS px. */
export interface EdgeInsets {
  top: number;
  bottom: number;
}

/** Clear of a typical top bar (64–72 px) and of a bottom bar plus a phone's tab dock. */
export const EDGE_INSETS: Readonly<EdgeInsets> = { top: 80, bottom: 136 };

/** The launcher a raw option or attribute names; anything but `corner` is the edge drop. */
export function parseLauncher(raw: string | null | undefined): Launcher {
  return raw === 'corner' ? 'corner' : 'edge';
}

/** Host insets are untrusted: only finite, non-negative numbers replace the defaults. */
export function edgeInsets(raw?: Partial<EdgeInsets> | null): EdgeInsets {
  const pick = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  return { top: pick(raw?.top, EDGE_INSETS.top), bottom: pick(raw?.bottom, EDGE_INSETS.bottom) };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** The stored place; a value this module never wrote (garbage, out of range) falls back to the default. */
export function readEdge(): number {
  const raw = readPref(EDGE_KEY);
  if (raw === null || raw.trim() === '') return EDGE_DEFAULT;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : EDGE_DEFAULT;
}

export function saveEdge(fraction: number): void {
  writePref(EDGE_KEY, String(Math.round(clamp01(fraction) * 1000) / 1000));
}

/**
 * The drop's top in px for `fraction` of its band. A viewport too short for
 * the band (a phone in landscape) centres the drop instead.
 */
export function edgeTop(fraction: number, vh: number, h: number, insets: EdgeInsets): number {
  const room = vh - insets.top - insets.bottom - h;
  if (room <= 0) return Math.max(0, Math.round((vh - h) / 2));
  return Math.round(insets.top + clamp01(fraction) * room);
}

/** The fraction a drop whose top is at `top` stands at — dragged past the band, it stops at its end. */
export function edgeFraction(top: number, vh: number, h: number, insets: EdgeInsets): number {
  const room = vh - insets.top - insets.bottom - h;
  if (room <= 0) return EDGE_DEFAULT;
  return clamp01((top - insets.top) / room);
}

/** Alt+↑/↓: the next place in that direction (staying at the end); null for any other key. */
export function edgeToward(fraction: number, key: string): number | null {
  if (key === 'ArrowUp') return clamp01(Math.round((fraction - EDGE_STEP) * 1000) / 1000);
  if (key === 'ArrowDown') return clamp01(Math.round((fraction + EDGE_STEP) * 1000) / 1000);
  return null;
}

/**
 * The corner marking parks the card from, and the coach reads its side from:
 * the upper half of the band is a top-right drop, the lower half a bottom-right one.
 */
export function edgeCorner(fraction: number): Corner {
  return fraction < 0.5 ? 'tr' : 'br';
}

/** The card's top beside a drop at `dropTop`: centred on it, `margin` inside the viewport. */
export function cardTopBeside(dropTop: number, dropH: number, cardH: number, vh: number, margin = 16): number {
  const centred = dropTop + dropH / 2 - cardH / 2;
  const max = vh - cardH - margin;
  if (max < margin) return Math.max(0, Math.round((vh - cardH) / 2));
  return Math.round(Math.min(max, Math.max(margin, centred)));
}
