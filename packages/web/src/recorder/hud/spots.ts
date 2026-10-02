/**
 * Where the web HUD may rest: a 3×3 grid without its centre — the six spots
 * of `@vitrinka/link/dock` (corners, top and bottom centre) plus middle-left
 * and middle-right, where the recording capsule turns vertical. A throw obeys
 * the shared dock's physics: its tuck verdict is taken as is, and a landing
 * projects the release along its velocity to the nearest of the eight.
 * Pure numbers: no DOM, no React.
 */
import {
  FLICK_PROJECTION_S,
  type Insets,
  type Rect,
  type Side,
  type Size,
  settle as settleSix,
} from '@vitrinka/link/dock';

export type { Insets, Rect, Side, Size };

export type Row = 't' | 'm' | 'b';
export type Col = 'l' | 'c' | 'r';
export type Spot = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

/** Where the HUD rests: a spot, or tucked into a side edge at `y` (0 top … 1 bottom). */
export type Place = { spot: Spot } | { tuck: Side; y: number };

/** Row-major, the order the Move to grid lays them out (its centre cell is empty). */
export const SPOTS: readonly Spot[] = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
export const DEFAULT_PLACE: Place = { spot: 'br' };

export const SPOT_NAMES: Record<Spot, string> = {
  tl: 'top left',
  tc: 'top centre',
  tr: 'top right',
  ml: 'middle left',
  mr: 'middle right',
  bl: 'bottom left',
  bc: 'bottom centre',
  br: 'bottom right',
};

export function rowOf(spot: Spot): Row {
  return spot[0] as Row;
}

export function colOf(spot: Spot): Col {
  return spot[1] as Col;
}

/** The middle row: the recording capsule stands up along the side edge. */
export function isVertical(spot: Spot): boolean {
  return rowOf(spot) === 'm';
}

/** The rect a HUD of `size` occupies when resting at `spot`. */
export function spotRect(spot: Spot, size: Size, view: Size, inset: Insets): Rect {
  const col = colOf(spot);
  const row = rowOf(spot);
  const x = col === 'l' ? inset.left : col === 'r' ? view.w - inset.right - size.w : (view.w - size.w) / 2;
  const y = row === 't' ? inset.top : row === 'b' ? view.h - inset.bottom - size.h : (view.h - size.h) / 2;
  return { x, y, w: size.w, h: size.h };
}

/**
 * Where a released HUD settles. `rect` is where it was let go (viewport px),
 * `velocity` the pointer's px/s at release.
 */
export function settle(rect: Rect, velocity: { x: number; y: number }, view: Size, inset: Insets): Place {
  const shared = settleSix(rect, velocity, view, inset);
  if ('tuck' in shared) return shared;
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

/** The spot a tucked HUD returns to: the nearest third on its side. */
export function untuck(place: Place): Spot {
  if ('spot' in place) return place.spot;
  const row: Row = place.y < 1 / 3 ? 't' : place.y > 2 / 3 ? 'b' : 'm';
  return `${row}${place.tuck === 'left' ? 'l' : 'r'}` as Spot;
}

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

const ROWS: readonly Row[] = ['t', 'm', 'b'];
const COLS: readonly Col[] = ['l', 'c', 'r'];

/** The spot an arrow key moves to; the empty centre is stepped over. */
export function neighbour(place: Place, arrow: Arrow): Place {
  const spot = untuck(place);
  if (!('spot' in place)) return { spot };
  let ri = ROWS.indexOf(rowOf(spot));
  let ci = COLS.indexOf(colOf(spot));
  const step = (dr: number, dc: number) => {
    ri = Math.min(2, Math.max(0, ri + dr));
    ci = Math.min(2, Math.max(0, ci + dc));
  };
  const [dr, dc] = arrow === 'ArrowLeft' ? [0, -1] : arrow === 'ArrowRight' ? [0, 1] : arrow === 'ArrowUp' ? [-1, 0] : [1, 0];
  step(dr, dc);
  if (ri === 1 && ci === 1) step(dr, dc);
  return { spot: `${ROWS[ri]}${COLS[ci]}` as Spot };
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
      return { tuck: o.tuck, y: Math.min(1, Math.max(0, o.y)) };
  }
  return DEFAULT_PLACE;
}
