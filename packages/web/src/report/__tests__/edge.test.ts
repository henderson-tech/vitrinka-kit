/**
 * The edge drop's place (vt-3811): a side edge and a fraction of the band
 * between the top and bottom insets, remembered per origin (the 0.12.0 number
 * still read, as the right edge), stepped with Alt+arrows, landing on the
 * nearer side after a drag; the card opening centred beside it; and the drop's
 * one-path outline.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import {
  cardTopBeside,
  DROP_FOOT,
  dropForm,
  dropPath,
  EDGE_DEFAULT,
  EDGE_HOME,
  EDGE_INSETS,
  EDGE_KEY,
  edgeCorner,
  edgeFraction,
  edgeInsets,
  edgeTop,
  edgeToward,
  nearerSide,
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

  it('steps with Alt+↑/↓, staying at the end, and crosses sides with Alt+←/→ at the same height; other keys are not moves', () => {
    const right = { side: 'right', at: 0.62 } as const;
    expect(edgeToward(right, 'ArrowUp')!.at).toBeCloseTo(0.52, 5);
    expect(edgeToward(right, 'ArrowDown')!.at).toBeCloseTo(0.72, 5);
    expect(edgeToward({ side: 'left', at: 0.95 }, 'ArrowDown')).toEqual({ side: 'left', at: 1 });
    expect(edgeToward({ side: 'right', at: 0.05 }, 'ArrowUp')).toEqual({ side: 'right', at: 0 });
    expect(edgeToward(right, 'ArrowLeft')).toEqual({ side: 'left', at: 0.62 });
    expect(edgeToward({ side: 'left', at: 0.3 }, 'ArrowRight')).toEqual({ side: 'right', at: 0.3 });
    // Toward where it already is: the same place, so nothing moves.
    expect(edgeToward(right, 'ArrowRight')).toEqual(right);
    expect(edgeToward(right, 'Enter')).toBeNull();
  });

  it('lands a drag on the nearer side edge', () => {
    expect([nearerSide(10, 1440), nearerSide(719, 1440), nearerSide(720, 1440), nearerSide(1430, 1440)]).toEqual(['left', 'left', 'right', 'right']);
  });

  it('parks marking from the top corner in the upper half, the bottom one below, on the drop’s side', () => {
    expect([edgeCorner(0.2), edgeCorner(0.49), edgeCorner(0.5), edgeCorner(0.9)]).toEqual(['tr', 'tr', 'br', 'br']);
    expect([edgeCorner(0.2, 'left'), edgeCorner(0.9, 'left'), edgeCorner(0.2, 'right')]).toEqual(['tl', 'bl', 'tr']);
  });
});

describe('remembering the place', () => {
  it('defaults to the right edge below the middle and ignores what it never wrote', () => {
    expect(readEdge()).toEqual({ side: 'right', at: EDGE_DEFAULT });
    expect(EDGE_HOME).toEqual({ side: 'right', at: EDGE_DEFAULT });
    const junk = [
      '',
      '   ',
      'abc',
      '-0.2',
      '1.5',
      'NaN',
      'Infinity',
      '0x1',
      '1e-1',
      'null',
      '[]',
      '"left"',
      '{"side":"top","at":0.4}',
      '{"side":"left"}',
      '{"side":"left","at":"0.4"}',
      '{"side":"left","at":1.2}',
      '{"side":"left","at":-0.1}',
      '{"side":"LEFT","at":0.4}',
      '{"side":"left","at":0.4',
    ];
    for (const raw of junk) {
      localStorage.setItem(EDGE_KEY, raw);
      expect(readEdge(), raw).toEqual({ side: 'right', at: EDGE_DEFAULT });
    }
  });

  it('reads the 0.12.0 number as a place on the right edge', () => {
    for (const [raw, at] of [['0.333', 0.333], ['0', 0], ['1', 1], ['.5', 0.5], [' 0.7 ', 0.7]] as const) {
      localStorage.setItem(EDGE_KEY, raw);
      expect(readEdge()).toEqual({ side: 'right', at });
    }
  });

  it('round-trips a saved side and place, clamped and rounded, keeping only the fields it knows', () => {
    saveEdge({ side: 'left', at: 0.3333333 });
    expect(JSON.parse(localStorage.getItem(EDGE_KEY)!)).toEqual({ side: 'left', at: 0.333 });
    expect(readEdge()).toEqual({ side: 'left', at: 0.333 });
    saveEdge({ side: 'right', at: 4 });
    expect(readEdge()).toEqual({ side: 'right', at: 1 });
    localStorage.setItem(EDGE_KEY, '{"side":"left","at":0.25,"extra":"<img>","__proto__":{"x":1}}');
    expect(readEdge()).toEqual({ side: 'left', at: 0.25 });
    expect(Object.keys(readEdge()).sort()).toEqual(['at', 'side']);
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

/** Every point the path goes through: the last two numbers of each M, L and A. */
function points(d: string): [number, number][] {
  return d
    .split(/(?=[MLAZ])/)
    .filter((c) => c[0] !== 'Z')
    .map((c) => c.slice(1).trim().split(/\s+/).map(Number).slice(-2) as [number, number]);
}

describe('the drop’s one outline', () => {
  it('moves from feet to the bare body to a free pill as it lets go of the wall', () => {
    expect(dropForm(1)).toEqual({ foot: 1, round: 0 });
    expect(dropForm(0.5)).toEqual({ foot: 0, round: 0 });
    expect(dropForm(0)).toEqual({ foot: 0, round: 1 });
    expect(dropForm(0.75).foot).toBeCloseTo(0.5, 5);
    expect(dropForm(0.25).round).toBeCloseTo(0.5, 5);
  });

  it('is one closed path whose feet stand on the wall above and below the body', () => {
    const fill = dropPath(42, 48, 'right', 1, 0);
    // One subpath: a single M, closed once — no pieces to show a seam between.
    expect(fill.match(/M/g)).toHaveLength(1);
    expect(fill.endsWith('Z')).toBe(true);
    // It starts on the wall at the top foot's tip, ends on it at the bottom one's, and closes along the wall.
    expect(fill.startsWith('M42 0 ')).toBe(true);
    expect(fill.endsWith(`42 ${48 + 2 * DROP_FOOT} Z`)).toBe(true);
  });

  it('mirrors on the left wall', () => {
    const right = dropPath(42, 48, 'right', 1, 0);
    const left = dropPath(42, 48, 'left', 1, 0);
    expect(left.startsWith(`M0 0`)).toBe(true);
    expect(points(left)).toEqual(points(right).map(([x, y]) => [42 - x, y]));
    // Mirrored, every arc turns the other way.
    const sweeps = (d: string) => [...d.matchAll(/A[\d.]+ [\d.]+ 0 0 ([01])/g)].map((m) => 1 - Number(m[1]));
    expect(sweeps(left)).toEqual(sweeps(right).map((v) => 1 - v));
  });

  it('grows with its width: the name widens the same one shape', () => {
    const narrow = dropPath(42, 48, 'right', 1, 0);
    const wide = dropPath(170, 48, 'right', 1, 0);
    expect(wide.match(/M/g)).toHaveLength(1);
    expect(wide).toContain('M170 0');
    expect(narrow).not.toBe(wide);
  });

  it('is a fully rounded pill with no feet when it is carried', () => {
    const fill = dropPath(42, 48, 'right', 0, 1);
    // Every corner an arc of the half-width, nothing reaching above or below the body's box.
    expect(fill.match(/A21 21/g)).toHaveLength(4);
    for (const [, y] of points(fill)) {
      expect(y).toBeGreaterThanOrEqual(DROP_FOOT);
      expect(y).toBeLessThanOrEqual(DROP_FOOT + 48);
    }
  });
});
