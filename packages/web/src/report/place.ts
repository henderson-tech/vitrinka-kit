/**
 * Where the one card sits while the reporter marks (vt-8020 D10 A): parked in
 * a corner of the viewport, clear of the top bar, and moved only when a mark
 * lands under it — then to the corner that covers the least of the marks. The
 * card never jumps between equally good corners: the current one wins a tie.
 */
import type { Rect } from './markers';

export type Corner = 'br' | 'bl' | 'tr' | 'tl';

export interface Frame {
  vw: number;
  vh: number;
  /** The card's fixed size. */
  w: number;
  h: number;
  /**
   * Clear space kept at the top (the marking bar), at the bottom and at the
   * sides — the widget takes them from where the card rests when marking
   * starts, so starting never moves it.
   */
  top: number;
  bottom: number;
  edge: number;
}

const ORDER: readonly Corner[] = ['br', 'bl', 'tr', 'tl'];
/** Breathing room around a mark: a card touching a mark's stroke still hides it. */
const PAD = 12;

export function cornerRect(c: Corner, f: Frame): Rect {
  const x = c === 'br' || c === 'tr' ? f.vw - f.w - f.edge : f.edge;
  const y = c === 'br' || c === 'bl' ? f.vh - f.h - f.bottom : f.top;
  return { x: Math.max(f.edge, x), y: Math.max(f.top, y), w: f.w, h: f.h };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w + PAD) - Math.max(a.x, b.x - PAD);
  const h = Math.min(a.y + a.h, b.y + b.h + PAD) - Math.max(a.y, b.y - PAD);
  return w > 0 && h > 0 ? w * h : 0;
}

function covered(c: Corner, marks: readonly Rect[], f: Frame): number {
  const r = cornerRect(c, f);
  return marks.reduce((sum, m) => sum + overlap(r, m), 0);
}

/** The corner the card should be in: `current` while it covers no mark, else the least-covering one. */
export function pickCorner(current: Corner, marks: readonly Rect[], f: Frame): Corner {
  const here = covered(current, marks, f);
  if (here === 0) return current;
  let best = current;
  let bestCover = here;
  for (const c of ORDER) {
    const cover = covered(c, marks, f);
    if (cover < bestCover) {
      best = c;
      bestCover = cover;
    }
  }
  return best;
}
