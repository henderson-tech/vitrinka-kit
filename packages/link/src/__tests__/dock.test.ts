import { describe, expect, it } from 'bun:test';

import { neighbour, parsePlace, settle, spotRect } from '../dock';

const view = { w: 1440, h: 810 };
const inset = { top: 16, right: 16, bottom: 16, left: 16 };
const size = { w: 72, h: 28 };
const still = { x: 0, y: 0 };

describe('dock', () => {
  it('rests each spot inside the insets', () => {
    expect(spotRect('br', size, view, inset)).toEqual({ x: 1352, y: 766, w: 72, h: 28 });
    expect(spotRect('tc', size, view, inset)).toEqual({ x: 684, y: 16, w: 72, h: 28 });
  });

  it('settles a slow release on the nearest spot', () => {
    expect(settle({ x: 200, y: 120, ...size }, still, view, inset)).toEqual({ spot: 'tl' });
    expect(settle({ x: 700, y: 600, ...size }, still, view, inset)).toEqual({ spot: 'bc' });
  });

  it('lands a flick where it is aimed, not where it was let go', () => {
    // Let go just right of centre-bottom, thrown hard up and right.
    expect(settle({ x: 760, y: 700, ...size }, { x: 2400, y: -2400 }, view, inset)).toEqual({ spot: 'tr' });
  });

  it('tucks when more than a third is pushed past a side edge, keeping the height', () => {
    expect(settle({ x: 1440 - 40, y: 391, ...size }, still, view, inset)).toEqual({ tuck: 'right', y: 0.5 });
    expect(settle({ x: -30, y: 391, ...size }, still, view, inset)).toEqual({ tuck: 'left', y: 0.5 });
    // A quarter past the edge is not a tuck.
    expect(settle({ x: 1440 - 54, y: 700, ...size }, still, view, inset)).toEqual({ spot: 'br' });
  });

  it('moves between spots with arrow keys and untucks to the nearer corner', () => {
    expect(neighbour({ spot: 'br' }, 'ArrowLeft')).toEqual({ spot: 'bc' });
    expect(neighbour({ spot: 'bl' }, 'ArrowLeft')).toEqual({ spot: 'bl' });
    expect(neighbour({ spot: 'bc' }, 'ArrowUp')).toEqual({ spot: 'tc' });
    expect(neighbour({ tuck: 'left', y: 0.2 }, 'ArrowRight')).toEqual({ spot: 'tl' });
  });

  it('reads back only a valid stored place', () => {
    expect(parsePlace('{"spot":"tc"}')).toEqual({ spot: 'tc' });
    expect(parsePlace({ tuck: 'right', y: 4 })).toEqual({ tuck: 'right', y: 1 });
    expect(parsePlace('{"spot":"middle"}')).toEqual({ spot: 'br' });
    expect(parsePlace('not json')).toEqual({ spot: 'br' });
  });
});
