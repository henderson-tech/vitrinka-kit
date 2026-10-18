/**
 * The seq lock's IndexedDB lane across tabs: Chromium keeps a copy of
 * localStorage in each renderer and delivers another tab's writes to it
 * later, unordered with the transaction hand-over. A tab numbering under
 * `withRecorderLock` must read what the last holder wrote, never the number
 * before it. Over fake-indexeddb (bun has no Web Locks).
 */
import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'bun:test';

import { withRecorderLock } from '../storage/lock';

/** One origin's localStorage as two tabs see it: each reads its own copy and hears the other's writes in order, `lagMs` later. */
function twoTabs(lagMs: number): [Storage, Storage] {
  const copies = [new Map<string, string>(), new Map<string, string>()] as const;
  const tab = (self: 0 | 1): Storage => {
    const own = copies[self];
    const write = (key: string, value: string | null) => {
      for (const copy of [own, copies[1 - self]!]) {
        const apply = () => (value === null ? copy.delete(key) : copy.set(key, value));
        if (copy === own) apply();
        else setTimeout(apply, lagMs);
      }
    };
    return {
      get length() { return own.size; },
      key: (i: number) => [...own.keys()][i] ?? null,
      getItem: (key: string) => own.get(key) ?? null,
      setItem: (key: string, value: string) => write(key, value),
      removeItem: (key: string) => write(key, null),
      clear: () => { for (const key of [...own.keys()]) write(key, null); },
    };
  };
  return [tab(0), tab(1)];
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('withRecorderLock', () => {
  it('a tab that has not heard the last holder yet never takes its number', async () => {
    const [a, b] = twoTabs(20);
    const taken: number[] = [];
    // The lock reads the calling tab's localStorage as it is entered.
    const allocate = (tab: Storage) => {
      Object.defineProperty(globalThis, 'localStorage', { value: tab, configurable: true, writable: true });
      return withRecorderLock('seq', () => {
        const seq = Number(tab.getItem('vitrinka.recorder.n') ?? 0) + 1;
        tab.setItem('vitrinka.recorder.n', String(seq));
        taken.push(seq);
      });
    };
    await Promise.all(Array.from({ length: 8 }, (_, i) => allocate(i % 2 ? b : a)));
    expect(taken).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
