/**
 * The HUD's cancelling listeners: always non-passive, and registered on the
 * native addEventListener even when zone.js has patched it (zone folds every
 * listener of a target + type + phase into the FIRST registrant's options,
 * which on an Angular host is CDK's passive keydown/mousedown/touchstart).
 */
import { describe, expect, it } from 'bun:test';

import { listen } from '../hud/listen';

type Seen = { via: string; type: string; options: unknown };

/** An EventTarget whose add/remove calls are journaled, optionally patched the way zone.js patches one. */
function target(zone: boolean): { t: EventTarget; seen: Seen[] } {
  const t = new EventTarget();
  const seen: Seen[] = [];
  const add = t.addEventListener.bind(t);
  const remove = t.removeEventListener.bind(t);
  const native = {
    add: (type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      seen.push({ via: 'native', type, options });
      add(type, fn, options);
    },
    remove: (type: string, fn: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
      seen.push({ via: 'native-remove', type, options });
      remove(type, fn, options);
    },
  };
  if (!zone) return { t: Object.assign(t, { addEventListener: native.add, removeEventListener: native.remove }), seen };
  return {
    t: Object.assign(t, {
      __zone_symbol__addEventListener: native.add,
      __zone_symbol__removeEventListener: native.remove,
      // zone's shared listener: whatever the caller asked, it runs passive.
      addEventListener: (type: string) => void seen.push({ via: 'zone', type, options: { passive: true } }),
      removeEventListener: (type: string) => void seen.push({ via: 'zone-remove', type, options: undefined }),
    }),
    seen,
  };
}

describe('listen', () => {
  it('registers non-passive and natively, bypassing a zone.js patch, and its remover unregisters', () => {
    for (const zone of [true, false]) {
      const { t, seen } = target(zone);
      let calls = 0;
      const off = listen(t, 'keydown', (e) => {
        calls++;
        e.preventDefault();
      }, { capture: true });
      const e = new Event('keydown', { cancelable: true });
      t.dispatchEvent(e);
      expect(calls).toBe(1);
      expect(e.defaultPrevented).toBe(true);
      off();
      t.dispatchEvent(new Event('keydown', { cancelable: true }));
      expect(calls).toBe(1);
      expect(seen).toEqual([
        { via: 'native', type: 'keydown', options: { capture: true, passive: false } },
        { via: 'native-remove', type: 'keydown', options: true },
      ]);
    }
  });
});
