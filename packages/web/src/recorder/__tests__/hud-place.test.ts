/**
 * HUD geometry: the eight spots (a throw, the arrows over the empty centre,
 * a tuck coming back) and where a float opens beside the dock — toward the
 * centre, sideways from a vertical dock, flipped and shifted into the viewport.
 */
import { describe, expect, it } from 'bun:test';

import { alignFor, placeFloating, towardCentre } from '../hud/place';
import { isVertical, neighbour, parsePlace, settle, untuck } from '../hud/spots';

const view = { w: 1440, h: 810 };
const inset = { top: 16, right: 16, bottom: 16, left: 16 };

describe('spots', () => {
  it('lands a release near a side edge on the middle row, which stands the pill up', () => {
    const at = settle({ x: 30, y: 380, w: 120, h: 28 }, { x: 0, y: 0 }, view, inset);
    expect(at).toEqual({ spot: 'ml' });
    expect(isVertical('ml')).toBe(true);
    expect(settle({ x: 1290, y: 400, w: 120, h: 28 }, { x: 0, y: 0 }, view, inset)).toEqual({ spot: 'mr' });
    // A flick still lands where it is thrown, and a push past the edge still tucks.
    expect(settle({ x: 600, y: 380, w: 120, h: 28 }, { x: 0, y: 2000 }, view, inset)).toEqual({ spot: 'bc' });
    expect(settle({ x: -60, y: 380, w: 120, h: 28 }, { x: 0, y: 0 }, view, inset)).toEqual({ tuck: 'left', y: expect.any(Number) });
  });

  it('steps arrows over the empty centre and back from a tuck to the nearest third', () => {
    expect(neighbour({ spot: 'br' }, 'ArrowUp')).toEqual({ spot: 'mr' });
    expect(neighbour({ spot: 'tc' }, 'ArrowDown')).toEqual({ spot: 'bc' });
    expect(neighbour({ spot: 'ml' }, 'ArrowRight')).toEqual({ spot: 'mr' });
    expect(untuck({ tuck: 'right', y: 0.5 })).toBe('mr');
    expect(untuck({ tuck: 'left', y: 0.1 })).toBe('tl');
    expect(parsePlace('{"spot":"ml"}')).toEqual({ spot: 'ml' });
    expect(parsePlace('{"spot":"mc"}')).toEqual({ spot: 'br' });
  });
});

describe('placeFloating', () => {
  const tip = { w: 120, h: 24 };

  it('flips a tooltip below a trigger at the top edge and shifts it off the right edge', () => {
    const p = placeFloating({ x: 1400, y: 16, w: 24, h: 24 }, tip, view, 'top', { margin: 6 });
    expect(p.side).toBe('bottom');
    expect(p.y).toBe(16 + 24 + 8);
    expect(p.x + tip.w).toBeLessThanOrEqual(view.w - 6);
    // The grow origin stays on the trigger, not the bubble's middle.
    expect(Number.parseInt(p.origin, 10)).toBeGreaterThan(tip.w / 2);
  });

  it('opens sideways from a vertical dock and keeps a tall menu inside the viewport', () => {
    const dock = { x: 16, y: 391, w: 36, h: 240 };
    const menu = { w: 252, h: 560 };
    const place = { spot: 'ml' } as const;
    const p = placeFloating(dock, menu, view, towardCentre(place), { align: alignFor(place) });
    expect(p.side).toBe('right');
    expect(p.x).toBe(16 + 36 + 8);
    expect(p.y).toBeGreaterThanOrEqual(8);
    expect(p.y + menu.h).toBeLessThanOrEqual(view.h - 8);
    expect(towardCentre({ spot: 'mr' })).toBe('left');
    expect(towardCentre({ spot: 'tc' })).toBe('bottom');
    expect(towardCentre({ tuck: 'right', y: 0.4 })).toBe('left');
  });

  it('aligns flush with the dock’s outer edge on a corner', () => {
    const dock = { x: 1300, y: 766, w: 124, h: 28 };
    const p = placeFloating(dock, { w: 252, h: 300 }, view, towardCentre({ spot: 'br' }), { align: alignFor({ spot: 'br' }) });
    expect(p.side).toBe('top');
    expect(p.x + 252).toBe(1424);
  });
});
