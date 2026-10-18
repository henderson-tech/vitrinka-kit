/**
 * Where the floating button docks (vt-8020 D9): any of the four corners,
 * dragged there (it snaps to the nearest on release) or moved with Alt+arrow
 * keys from the focused button; remembered per origin in localStorage. The
 * card's resting place follows the button's corner — above it at the bottom,
 * below it at the top — and marking parks it from there (place.ts).
 */
import type { Point } from './markers';
import type { Corner } from './place';
import { readPref, writePref } from './settings';

export const DOCK_KEY = 'vitrinka.report.dock';
/** A press that travels less than this is a click, never a drag. */
export const DRAG_THRESHOLD = 6;

const CORNERS: Readonly<Record<'t' | 'b', Readonly<Record<'l' | 'r', Corner>>>> = {
  t: { l: 'tl', r: 'tr' },
  b: { l: 'bl', r: 'br' },
};
const ALL: readonly Corner[] = ['br', 'bl', 'tr', 'tl'];

function vertical(c: Corner): 't' | 'b' {
  return c === 'tl' || c === 'tr' ? 't' : 'b';
}

function horizontal(c: Corner): 'l' | 'r' {
  return c === 'tl' || c === 'bl' ? 'l' : 'r';
}

export function readDock(): Corner {
  const v = readPref(DOCK_KEY);
  return ALL.find((c) => c === v) ?? 'br';
}

export function saveDock(c: Corner): void {
  writePref(DOCK_KEY, c);
}

/** The corner whose quarter of the viewport holds `p` (the dragged button's centre). */
export function nearestCorner(p: Point, vw: number, vh: number): Corner {
  return CORNERS[p.y < vh / 2 ? 't' : 'b'][p.x < vw / 2 ? 'l' : 'r'];
}

/** Alt+arrow: the corner in that direction (the same one at the edge); null for any other key. */
export function cornerToward(c: Corner, key: string): Corner | null {
  if (key === 'ArrowLeft' || key === 'ArrowRight') return CORNERS[vertical(c)][key === 'ArrowLeft' ? 'l' : 'r'];
  if (key === 'ArrowUp' || key === 'ArrowDown') return CORNERS[key === 'ArrowUp' ? 't' : 'b'][horizontal(c)];
  return null;
}
