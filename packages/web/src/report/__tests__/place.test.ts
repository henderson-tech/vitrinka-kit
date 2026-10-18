/**
 * The one card's parking rule (vt-8020 D10 A): it stays put while it covers
 * no mark, and a mark landing under it moves it to the least-covering corner.
 */
import { describe, expect, it } from 'bun:test';

import { cornerRect, type Frame, pickCorner } from '../place';

const F: Frame = { vw: 1440, vh: 810, w: 380, h: 440, top: 72, edge: 16 };

describe('pickCorner', () => {
  it('keeps the current corner while no mark is under it', () => {
    expect(pickCorner('br', [{ x: 100, y: 100, w: 200, h: 80 }], F)).toBe('br');
  });

  it('moves away from a mark drawn under the card', () => {
    const under = cornerRect('br', F);
    const mark = { x: under.x + 40, y: under.y + 40, w: 120, h: 60 };
    expect(pickCorner('br', [mark], F)).not.toBe('br');
    expect(pickCorner('br', [mark], F)).toBe('bl');
  });

  it('picks the corner covering the least when every corner covers something', () => {
    const marks = (['br', 'bl', 'tr'] as const).map((c) => cornerRect(c, F));
    const small = cornerRect('tl', F);
    marks.push({ x: small.x, y: small.y, w: 20, h: 20 });
    expect(pickCorner('br', marks, F)).toBe('tl');
  });

  it('never parks under the top bar', () => {
    expect(cornerRect('tr', F).y).toBe(F.top);
  });
});
