/**
 * Shared recorder state: the subscription the HUD re-renders
 * off, and the route the capture layers stamp onto every event. Small surface,
 * but a leaked listener re-renders the HUD forever and a stale route mislabels
 * a whole session's timeline lane.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { currentRoute, notify, subscribe } from '../state';

/**
 * Snapshot at MODULE LOAD, before any beforeEach can assign to it. Asserting on
 * `currentRoute` after the suite's reset passed even if `state.ts`'s initializer
 * were changed to a stale route — the test verified the reset, not the default
 *.
 */
const INITIAL_ROUTE = { ...currentRoute };

beforeEach(() => {
  currentRoute.lane = 'root';
  currentRoute.pathname = '/';
});

describe('subscribe / notify', () => {
  it('calls every subscriber on notify', () => {
    const seen: string[] = [];
    const offA = subscribe(() => seen.push('a'));
    const offB = subscribe(() => seen.push('b'));
    notify();
    expect(seen.sort()).toEqual(['a', 'b']);
    offA();
    offB();
  });

  it('stops calling a subscriber after its unsubscribe', () => {
    let calls = 0;
    const off = subscribe(() => {
      calls++;
    });
    notify();
    expect(calls).toBe(1);
    off();
    notify();
    expect(calls).toBe(1); // no leak — the HUD stops re-rendering
  });

  it('unsubscribing twice is harmless', () => {
    const off = subscribe(() => undefined);
    off();
    expect(() => off()).not.toThrow();
  });

  it('a subscriber added twice is registered once (Set semantics)', () => {
    let calls = 0;
    const fn = () => {
      calls++;
    };
    const off1 = subscribe(fn);
    const off2 = subscribe(fn);
    notify();
    expect(calls).toBe(1);
    off1();
    off2();
  });
});

describe('currentRoute', () => {
  it('is a live shared object the capture layers read through', () => {
    currentRoute.lane = 'orders';
    currentRoute.pathname = '/(personal)/(tabs)/orders';
    // Same module instance everywhere — capture layers stamp these onto events.
    expect(currentRoute).toMatchObject({
      lane: 'orders',
      pathname: '/(personal)/(tabs)/orders',
    });
  });

  it('defaults to the root lane before any navigation is observed', () => {
    // Uses the module-load snapshot, so this fails if state.ts's initializer
    // changes — unlike an assertion made after the suite's own reset.
    expect(INITIAL_ROUTE).toEqual({ lane: 'root', pathname: '/' });
  });
});
