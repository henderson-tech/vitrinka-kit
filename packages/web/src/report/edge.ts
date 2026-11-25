/**
 * The edge drop (vt-3811): the default launcher rests on a side edge of the
 * viewport (the right one until the reporter moves it), a little below the
 * middle. Its place is a side and a fraction of the band it may use (0 = the
 * top of the band, 1 = the bottom), so it lands in the same proportion when
 * the window changes height; the band keeps clear of a page's top bar and its
 * bottom bars (an order bar, a phone's tab dock). The place is remembered per
 * origin.
 *
 * Pressed and moved it comes off the wall as a free pill and follows the
 * pointer anywhere; let go, it lands on the NEARER side edge at the height it
 * was let go (inside the band). The card opens beside it, toward the middle of
 * the page, centred on it and kept inside the viewport.
 *
 * Its outline is ONE path (`dropPath`): the body and the two concave meniscus
 * feet where it meets the wall, so nothing can show a seam between the pieces
 * of a shape drawn in parts.
 */
import type { Corner } from './place';
import { readPref, writePref } from './settings';

export type Launcher = 'edge' | 'corner';
/** The side edge the drop rests on. */
export type EdgeSide = 'left' | 'right';
/** Where the drop rests: its side, and how far down its band (0–1). */
export interface EdgePlace {
  side: EdgeSide;
  at: number;
}

export const EDGE_KEY = 'vitrinka.report.edge';
/** A little below the middle: under the content people read, above the bottom bars. */
export const EDGE_DEFAULT = 0.62;
/** Where a drop nobody moved rests: the right edge, a little below the middle. */
export const EDGE_HOME: Readonly<EdgePlace> = { side: 'right', at: EDGE_DEFAULT };
/** Alt+↑/↓ moves the drop by this share of its band. */
export const EDGE_STEP = 0.1;
/** How far each meniscus foot reaches up or down the wall from the body, in CSS px (styles: `.fab-shape`). */
export const DROP_FOOT = 11;

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

function round3(v: number): number {
  return Math.round(clamp01(v) * 1000) / 1000;
}

/** 0.12.0 stored the fraction alone, as a plain decimal ("0.62"): a place on the right edge. */
const LEGACY = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function fraction(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

/**
 * The stored place. Storage is untrusted: the legacy number (0.12.0) is a place on the right edge; the
 * current record is `{"side":"left"|"right","at":0–1}` and only those two fields are read; anything else
 * (garbage, out of range, another shape, an unknown side) is the default place.
 */
export function readEdge(): EdgePlace {
  const raw = readPref(EDGE_KEY)?.trim() ?? '';
  if (raw === '') return { ...EDGE_HOME };
  if (LEGACY.test(raw)) {
    const at = fraction(Number(raw));
    return at === null ? { ...EDGE_HOME } : { side: 'right', at };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EDGE_HOME };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ...EDGE_HOME };
  const rec = parsed as Record<string, unknown>;
  const side = rec.side === 'left' || rec.side === 'right' ? rec.side : null;
  const at = fraction(rec.at);
  return side && at !== null ? { side, at } : { ...EDGE_HOME };
}

export function saveEdge(place: EdgePlace): void {
  const side: EdgeSide = place.side === 'left' ? 'left' : 'right';
  writePref(EDGE_KEY, JSON.stringify({ side, at: round3(place.at) }));
}

/** The side edge nearer to a point at `x` in a viewport `vw` wide (the middle goes right, where the drop starts). */
export function nearerSide(x: number, vw: number): EdgeSide {
  return x < vw / 2 ? 'left' : 'right';
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

/**
 * Alt+arrows: ↑/↓ step along the edge (staying at the end), ←/→ cross to that side at the same height;
 * null for any other key. An arrow toward where the drop already is returns the same place.
 */
export function edgeToward(place: EdgePlace, key: string): EdgePlace | null {
  if (key === 'ArrowUp') return { side: place.side, at: round3(place.at - EDGE_STEP) };
  if (key === 'ArrowDown') return { side: place.side, at: round3(place.at + EDGE_STEP) };
  if (key === 'ArrowLeft') return { side: 'left', at: place.at };
  if (key === 'ArrowRight') return { side: 'right', at: place.at };
  return null;
}

/**
 * The corner marking parks the card from, and the coach reads its side from: the drop's side, and the
 * upper half of the band is a top corner, the lower half a bottom one.
 */
export function edgeCorner(fraction: number, side: EdgeSide = 'right'): Corner {
  const top = fraction < 0.5;
  if (side === 'left') return top ? 'tl' : 'bl';
  return top ? 'tr' : 'br';
}

/** The card's top beside a drop at `dropTop`: centred on it, `margin` inside the viewport. */
export function cardTopBeside(dropTop: number, dropH: number, cardH: number, vh: number, margin = 16): number {
  const centred = dropTop + dropH / 2 - cardH / 2;
  const max = vh - cardH - margin;
  if (max < margin) return Math.max(0, Math.round((vh - cardH) / 2));
  return Math.round(Math.min(max, Math.max(margin, centred)));
}

/**
 * How attached the drop is to its wall, 0–1 (a little past 1 while the feet overshoot as they regrow):
 * 1 rests with both meniscus feet; 0.5 is the body alone, square against the wall (what the card grows
 * from); 0 is the free pill, rounded on every side, that a drag carries. One number, so one tween moves
 * the shape through every stage without a jump between them.
 */
export function dropForm(attach: number): { foot: number; round: number } {
  return { foot: Math.max(0, 2 * attach - 1), round: Math.min(1, Math.max(0, 1 - 2 * attach)) };
}

/**
 * The drop's outline for a body `w`×`h` on `side`, as SVG path data in a box `DROP_FOOT` taller above and
 * below the body (the feet reach into it). `foot` is the feet's share of `DROP_FOOT`; `round` rounds the
 * wall-side corners (0 square, 1 a full pill). The path is closed: body and feet one area, the wall side a
 * straight line on the wall.
 */
export function dropPath(w: number, h: number, side: EdgeSide, foot: number, round: number): string {
  const o = DROP_FOOT;
  const f = Math.min(DROP_FOOT * 1.2, Math.max(0, foot * DROP_FOOT), w / 2);
  const rw = f > 0.05 ? 0 : Math.min(1, Math.max(0, round)) * Math.min(h / 2, w / 2);
  // The page side's corners: a half-round end, never wider than what the wall side leaves.
  const r = Math.max(0, Math.min(h / 2, w - Math.max(f, rw)));
  const left = side === 'left';
  const n = (v: number) => String(Math.round(v * 100) / 100);
  // Drawn for the right wall (x = w); the left one mirrors x, which turns every arc the other way.
  const p = (x: number, y: number) => `${n(left ? w - x : x)} ${n(y)}`;
  const arc = (rad: number, sweep: 0 | 1, x: number, y: number) => `A${n(rad)} ${n(rad)} 0 0 ${left ? 1 - sweep : sweep} ${p(x, y)}`;
  const seg: string[] = [];
  // Counter-clockwise from the wall above the body, round the page side, back to the wall below it.
  if (f > 0.05) seg.push(`M${p(w, o - f)}`, arc(f, 1, w - f, o));
  else if (rw > 0.05) seg.push(`M${p(w, o + rw)}`, arc(rw, 0, w - rw, o));
  else seg.push(`M${p(w, o)}`);
  seg.push(`L${p(r, o)}`, arc(r, 0, 0, o + r), `L${p(0, o + h - r)}`, arc(r, 0, r, o + h));
  if (f > 0.05) seg.push(`L${p(w - f, o + h)}`, arc(f, 1, w, o + h + f));
  else if (rw > 0.05) seg.push(`L${p(w - rw, o + h)}`, arc(rw, 0, w, o + h - rw));
  else seg.push(`L${p(w, o + h)}`);
  return `${seg.join(' ')} Z`;
}
