/**
 * The button's dock (vt-8020 D9): a drop snaps to the corner whose quarter
 * holds the button, Alt+arrows step to the corner in that direction, and the
 * corner and the size are remembered on this browser (defaults otherwise).
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { cornerToward, DOCK_KEY, nearestCorner, readDock, saveDock } from '../drag';
import { readSize, SIZE_KEY } from '../settings';

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

describe('the dock', () => {
  it('snaps a drop to the nearest corner', () => {
    expect(nearestCorner({ x: 100, y: 100 }, 1440, 810)).toBe('tl');
    expect(nearestCorner({ x: 1300, y: 120 }, 1440, 810)).toBe('tr');
    expect(nearestCorner({ x: 200, y: 700 }, 1440, 810)).toBe('bl');
    expect(nearestCorner({ x: 721, y: 406 }, 1440, 810)).toBe('br');
  });

  it('steps with Alt+arrows, staying put at the edge; other keys are not moves', () => {
    expect([cornerToward('br', 'ArrowLeft'), cornerToward('br', 'ArrowUp'), cornerToward('tl', 'ArrowRight'), cornerToward('tl', 'ArrowDown')]).toEqual(['bl', 'tr', 'tr', 'bl']);
    expect(cornerToward('br', 'ArrowRight')).toBe('br');
    expect(cornerToward('br', 'a')).toBeNull();
  });

  it('remembers the corner and the size, and ignores what it never wrote', () => {
    expect([readDock(), readSize()]).toEqual(['br', 'md']);
    saveDock('tl');
    localStorage.setItem(SIZE_KEY, 'huge');
    expect([localStorage.getItem(DOCK_KEY), readDock(), readSize()]).toEqual(['tl', 'tl', 'md']);
  });
});
