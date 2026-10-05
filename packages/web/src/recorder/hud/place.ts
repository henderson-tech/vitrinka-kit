/**
 * Where a floating surface (tooltip, menu, sheet, details card) sits next to
 * its anchor: on the preferred side when it fits, flipped to the opposite one
 * when only that fits, and shifted along the other axis so it never leaves
 * the viewport. The preferred side points from the dock toward the page
 * centre — up from a bottom dock, down from a top one, sideways from a
 * vertical (middle-row) or tucked one. Pure numbers.
 */
import { colOf, type Place, rowOf, untuck } from './spots';

export type FloatSide = 'top' | 'bottom' | 'left' | 'right';
export type FloatAlign = 'start' | 'center' | 'end';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  x: number;
  y: number;
  side: FloatSide;
  /** CSS transform-origin: the point of the surface nearest the anchor. */
  origin: string;
}

export interface PlaceOptions {
  align?: FloatAlign;
  /** Distance from the anchor. */
  gap?: number;
  /** Closest the surface may come to a viewport edge. */
  margin?: number;
}

const OPPOSITE: Record<FloatSide, FloatSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(hi, Math.max(lo, v));
}

/** Place a `size` surface beside `anchor` within `view`. */
export function placeFloating(
  anchor: Box,
  size: { w: number; h: number },
  view: { w: number; h: number },
  side: FloatSide,
  opts: PlaceOptions = {},
): Placed {
  const gap = opts.gap ?? 8;
  const m = opts.margin ?? 8;
  const align = opts.align ?? 'center';
  const main = (s: FloatSide): number =>
    s === 'top'
      ? anchor.y - gap - size.h
      : s === 'bottom'
        ? anchor.y + anchor.h + gap
        : s === 'left'
          ? anchor.x - gap - size.w
          : anchor.x + anchor.w + gap;
  const room = (s: FloatSide): number => {
    const p = main(s);
    return s === 'top' || s === 'left' ? p - m : (s === 'bottom' ? view.h : view.w) - m - (p + (s === 'bottom' ? size.h : size.w));
  };
  let chosen = side;
  if (room(side) < 0 && room(OPPOSITE[side]) > room(side)) chosen = OPPOSITE[side];
  const vertical = chosen === 'top' || chosen === 'bottom';
  const [aStart, aLen, sLen, vLen] = vertical ? [anchor.x, anchor.w, size.w, view.w] : [anchor.y, anchor.h, size.h, view.h];
  const cross = align === 'start' ? aStart : align === 'end' ? aStart + aLen - sLen : aStart + aLen / 2 - sLen / 2;
  const c = clamp(cross, m, vLen - m - sLen);
  const p = vertical ? clamp(main(chosen), m, view.h - m - size.h) : clamp(main(chosen), m, view.w - m - size.w);
  const x = vertical ? c : p;
  const y = vertical ? p : c;
  // The grow origin: the anchor's centre, projected onto the facing edge.
  const ox = vertical ? clamp(anchor.x + anchor.w / 2 - x, 0, size.w) : chosen === 'left' ? size.w : 0;
  const oy = vertical ? (chosen === 'top' ? size.h : 0) : clamp(anchor.y + anchor.h / 2 - y, 0, size.h);
  return { x, y, side: chosen, origin: `${Math.round(ox)}px ${Math.round(oy)}px` };
}

/** The side a surface opens on from the dock: toward the page centre. */
export function towardCentre(place: Place): FloatSide {
  if ('tuck' in place) return place.tuck === 'left' ? 'right' : 'left';
  const row = rowOf(place.spot);
  if (row === 't') return 'bottom';
  if (row === 'b') return 'top';
  return colOf(place.spot) === 'l' ? 'right' : 'left';
}

/** How a surface lines up with the dock along the other axis: flush with the dock's outer edge. */
export function alignFor(place: Place): FloatAlign {
  const spot = untuck(place);
  if ('tuck' in place || rowOf(spot) === 'm') return 'center';
  const col = colOf(spot);
  return col === 'l' ? 'start' : col === 'r' ? 'end' : 'center';
}
