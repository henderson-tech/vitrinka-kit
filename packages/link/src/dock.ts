/**
 * @vitrinka/link/dock — where a recorder HUD may rest, shared by every
 * recorder (web, Expo, the extension's port) so a throw lands the same way
 * everywhere.
 *
 * Six spots — the four corners plus top and bottom centre. A release is
 * projected along its velocity (iOS picture-in-picture: a flick lands where
 * it is aimed, not merely nearest) and settles on the spot closest to the
 * projected centre. A release with more than a third of the HUD pushed past
 * a side edge tucks it into a tab on that edge instead, at the height it was
 * dropped. Pure numbers: no DOM, no React Native.
 */

export type Spot = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br';
export type Side = 'left' | 'right';

/** Where the HUD rests: a spot, or tucked into a side edge at `y` (0 top … 1 bottom). */
export type Place = { spot: Spot } | { tuck: Side; y: number };

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Distance from the viewport edges, safe-area insets already added. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const SPOTS: readonly Spot[] = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
export const DEFAULT_PLACE: Place = { spot: 'br' };

/** Seconds of travel a release is projected along its velocity. */
export const FLICK_PROJECTION_S = 0.3;
/** Fraction of the HUD's width past a side edge that tucks it. */
export const TUCK_FRACTION = 1 / 3;

export function rowOf(spot: Spot): 't' | 'b' {
  return spot[0] as 't' | 'b';
}

export function colOf(spot: Spot): 'l' | 'c' | 'r' {
  return spot[1] as 'l' | 'c' | 'r';
}

/** The rect a HUD of `size` occupies when resting at `spot`. */
export function spotRect(spot: Spot, size: Size, view: Size, inset: Insets): Rect {
  const col = colOf(spot);
  const x = col === 'l' ? inset.left : col === 'r' ? view.w - inset.right - size.w : (view.w - size.w) / 2;
  const y = rowOf(spot) === 't' ? inset.top : view.h - inset.bottom - size.h;
  return { x, y, w: size.w, h: size.h };
}

/**
 * Where a released HUD settles. `rect` is where it was let go (viewport
 * px), `velocity` the pointer's px/s at release.
 */
export function settle(rect: Rect, velocity: { x: number; y: number }, view: Size, inset: Insets): Place {
  const past = Math.max(-rect.x, rect.x + rect.w - view.w);
  if (past > rect.w * TUCK_FRACTION) {
    const side: Side = -rect.x > rect.x + rect.w - view.w ? 'left' : 'right';
    return { tuck: side, y: clamp01((rect.y + rect.h / 2) / Math.max(1, view.h)) };
  }
  const px = rect.x + rect.w / 2 + velocity.x * FLICK_PROJECTION_S;
  const py = rect.y + rect.h / 2 + velocity.y * FLICK_PROJECTION_S;
  let best: Spot = 'br';
  let bestD = Infinity;
  for (const spot of SPOTS) {
    const r = spotRect(spot, rect, view, inset);
    const d = Math.hypot(r.x + r.w / 2 - px, r.y + r.h / 2 - py);
    if (d < bestD) {
      bestD = d;
      best = spot;
    }
  }
  return { spot: best };
}

/** The spot a tucked HUD returns to: the nearer corner on its side. */
export function untuck(place: Place): Spot {
  if ('spot' in place) return place.spot;
  return `${place.y < 0.5 ? 't' : 'b'}${place.tuck === 'left' ? 'l' : 'r'}` as Spot;
}

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** The spot an arrow key moves to — the keyboard alternative to dragging. */
export function neighbour(place: Place, arrow: Arrow): Place {
  const spot = untuck(place);
  if (!('spot' in place)) return { spot };
  const cols = ['l', 'c', 'r'] as const;
  let row = rowOf(spot);
  let ci = cols.indexOf(colOf(spot));
  if (arrow === 'ArrowLeft') ci = Math.max(0, ci - 1);
  else if (arrow === 'ArrowRight') ci = Math.min(2, ci + 1);
  else if (arrow === 'ArrowUp') row = 't';
  else row = 'b';
  return { spot: `${row}${cols[ci]}` as Spot };
}

/** A stored place, validated; anything else is the default. */
export function parsePlace(raw: unknown): Place {
  if (typeof raw === 'string') {
    try {
      return parsePlace(JSON.parse(raw));
    } catch {
      return DEFAULT_PLACE;
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.spot === 'string' && (SPOTS as readonly string[]).includes(o.spot)) return { spot: o.spot as Spot };
    if ((o.tuck === 'left' || o.tuck === 'right') && typeof o.y === 'number' && Number.isFinite(o.y))
      return { tuck: o.tuck, y: clamp01(o.y) };
  }
  return DEFAULT_PLACE;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
