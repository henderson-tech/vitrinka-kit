/**
 * The edge drop's place (vt-3811): a fraction of the band between the top and
 * bottom insets, remembered per origin, stepped with Alt+↑/↓, and the card
 * opening centred beside it.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  cardTopBeside,
  EDGE_DEFAULT,
  EDGE_INSETS,
  EDGE_KEY,
  edgeCorner,
  edgeFraction,
  edgeInsets,
  edgeTop,
  edgeToward,
  parseLauncher,
  readEdge,
  saveEdge,
} from '../edge';

beforeEach(() => {
  const m = new Map<string, string>();
  const shim: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
});

describe('the launcher', () => {
  it('is the edge drop unless the host asks for the corner button', () => {
    expect([parseLauncher(undefined), parseLauncher(null), parseLauncher(''), parseLauncher('edge'), parseLauncher('pill')]).toEqual([
      'edge',
      'edge',
      'edge',
      'edge',
      'edge',
    ]);
    expect(parseLauncher('corner')).toBe('corner');
  });

  it('takes only finite, non-negative insets from the host', () => {
    expect(edgeInsets()).toEqual({ ...EDGE_INSETS });
    expect(edgeInsets({ bottom: 200 })).toEqual({ top: EDGE_INSETS.top, bottom: 200 });
    expect(edgeInsets({ top: -4, bottom: Number.NaN })).toEqual({ ...EDGE_INSETS });
    expect(edgeInsets({ top: '40' as unknown as number })).toEqual({ ...EDGE_INSETS });
  });
});

describe('the place along the edge', () => {
  const insets = { top: 80, bottom: 136 };

  it('maps a fraction to a top inside the band, and back', () => {
    // band: 810 - 80 - 136 - 48 = 546 px of room
    expect(edgeTop(0, 810, 48, insets)).toBe(80);
    expect(edgeTop(1, 810, 48, insets)).toBe(626);
    expect(edgeTop(0.5, 810, 48, insets)).toBe(353);
    expect(edgeFraction(353, 810, 48, insets)).toBeCloseTo(0.5, 2);
  });

  it('stops a drag at the ends of the band', () => {
    expect(edgeFraction(-300, 810, 48, insets)).toBe(0);
    expect(edgeFraction(5000, 810, 48, insets)).toBe(1);
    expect(edgeTop(7, 810, 48, insets)).toBe(626);
  });

  it('centres the drop when the viewport is too short for the band', () => {
    expect(edgeTop(0.9, 240, 48, insets)).toBe(96);
    expect(edgeFraction(10, 240, 48, insets)).toBe(EDGE_DEFAULT);
  });

  it('steps with Alt+↑/↓, staying at the end; other keys are not moves', () => {
    expect(edgeToward(0.62, 'ArrowUp')).toBeCloseTo(0.52, 5);
    expect(edgeToward(0.62, 'ArrowDown')).toBeCloseTo(0.72, 5);
    expect(edgeToward(0.95, 'ArrowDown')).toBe(1);
    expect(edgeToward(0.05, 'ArrowUp')).toBe(0);
    expect(edgeToward(0.5, 'ArrowLeft')).toBeNull();
  });

  it('parks marking from the top corner in the upper half, the bottom one below', () => {
    expect([edgeCorner(0.2), edgeCorner(0.49), edgeCorner(0.5), edgeCorner(0.9)]).toEqual(['tr', 'tr', 'br', 'br']);
  });
});

describe('remembering the place', () => {
  it('defaults below the middle and ignores what it never wrote', () => {
    expect(readEdge()).toBe(EDGE_DEFAULT);
    for (const junk of ['', 'abc', '-0.2', '1.5', 'NaN', 'Infinity']) {
      localStorage.setItem(EDGE_KEY, junk);
      expect(readEdge()).toBe(EDGE_DEFAULT);
    }
  });

  it('round-trips a saved place, clamped and rounded', () => {
    saveEdge(0.3333333);
    expect(localStorage.getItem(EDGE_KEY)).toBe('0.333');
    expect(readEdge()).toBe(0.333);
    saveEdge(4);
    expect(readEdge()).toBe(1);
  });
});

describe('the card beside the drop', () => {
  it('is centred on the drop and kept inside the viewport', () => {
    expect(cardTopBeside(400, 48, 460, 900)).toBe(194);
    expect(cardTopBeside(90, 48, 460, 900)).toBe(16);
    expect(cardTopBeside(820, 48, 460, 900)).toBe(424);
  });

  it('is centred in a viewport shorter than the card and its margins', () => {
    expect(cardTopBeside(100, 48, 460, 480)).toBe(10);
  });
});
