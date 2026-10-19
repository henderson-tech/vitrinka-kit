/**
 * The one card's parking rule (vt-8020 D10 A): it stays put while it covers
 * no mark, and a mark landing under it moves it to the least-covering corner.
 */
import { describe, expect, it } from 'bun:test';

import { coachSide, cornerRect, type Frame, pickCorner } from '../place';

const F: Frame = { vw: 1440, vh: 810, w: 380, h: 440, top: 72, bottom: 96, edge: 16 };

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

  it('keeps the bottom inset the card rested with, so marking starts where the card is', () => {
    expect(cornerRect('br', F)).toEqual({ x: 1440 - 380 - 16, y: 810 - 440 - 96, w: 380, h: 440 });
  });
});

describe('coachSide', () => {
  const coach = { w: 300, h: 168 };

  it('rides on the edge facing the open page: above a bottom card, below a top one', () => {
    expect(coachSide('br', F, coach, 10)).toBe('above');
    expect(coachSide('tl', F, coach, 10)).toBe('below');
  });

  it('goes beside the card, towards the middle, when the viewport is too short for it', () => {
    const short = { ...F, vh: 640 };
    expect(coachSide('br', short, coach, 10)).toBe('left');
    expect(coachSide('bl', short, coach, 10)).toBe('right');
  });

  it('lies over the card when a phone leaves no room around it', () => {
    expect(coachSide('br', { vw: 390, vh: 700, w: 358, h: 560, top: 72, bottom: 84, edge: 16 }, coach, 10)).toBe('over');
  });
});
