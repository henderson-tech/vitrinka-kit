/**
 * Navigation lane handover (ONE recorder): with two recorder bundles on a
 * page only the owner of the global History wrap hears SPA navigations, so a
 * bundle that follows and then leads must start from where the document is
 * now — not from the route it saw at mount.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ownNavLane, primeNavigation } from '../capture/nav';
import { __bufferForTests, setState } from '../queue';
import { startSession } from '../session';
import { currentRoute } from '../state';
import { fakeLocation, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;
const navs = () => __bufferForTests().filter((e) => e.kind === 'nav').map((e) => e.payload);

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation('https://app.example.test/orders');
  primeNavigation();
});
afterEach(() => stub.restore());

describe('nav lane handover', () => {
  it('taking the lane over from another bundle catches up the navigation it missed', () => {
    const g = globalThis as { __vitrinkaRecorderNavPatched?: unknown; __vitrinkaRecorderNavUnpatch?: () => void };
    let theirUnpatch = 0;
    g.__vitrinkaRecorderNavPatched = {};
    g.__vitrinkaRecorderNavUnpatch = () => {
      theirUnpatch += 1;
      delete g.__vitrinkaRecorderNavPatched;
      delete g.__vitrinkaRecorderNavUnpatch;
    };
    setState(liveSession());
    // The other bundle's History wrap heard this one; this bundle did not.
    fakeLocation('https://app.example.test/checkout');
    expect(currentRoute.pathname).toBe('/orders');
    expect(ownNavLane()).toBe(true);
    expect(theirUnpatch).toBe(1);
    expect(currentRoute.pathname).toBe('/checkout');
    expect(navs()).toEqual([expect.objectContaining({ route: '/checkout', spa: true })]);
    // Already its own: nothing more.
    expect(ownNavLane()).toBe(false);
    expect(navs()).toHaveLength(1);
  });

  it('a Start names where the document is now, even when the route lagged', async () => {
    fakeLocation('https://app.example.test/checkout');
    expect(currentRoute.pathname).toBe('/orders');
    await startSession();
    expect(navs()[0]).toMatchObject({ route: '/checkout', url: 'https://app.example.test/checkout' });
    expect(currentRoute.pathname).toBe('/checkout');
  });
});
