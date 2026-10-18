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

/**
 * Number the way the seq allocator does, under `lock` (each case its own: a
 * fake-indexeddb record outlives the case); `holdMs` keeps the lock busy.
 */
function allocator(lock: string, taken: number[]) {
  return (tab: Storage, holdMs = 0) => {
    // The lock reads the calling tab's localStorage as it is entered.
    Object.defineProperty(globalThis, 'localStorage', { value: tab, configurable: true, writable: true });
    return withRecorderLock(lock, () => {
      for (const until = Date.now() + holdMs; Date.now() < until;);
      const seq = Number(tab.getItem('vitrinka.recorder.n') ?? 0) + 1;
      tab.setItem('vitrinka.recorder.n', String(seq));
      taken.push(seq);
    });
  };
}

describe('withRecorderLock', () => {
  it('a tab that has not heard the last holder yet never takes its number', async () => {
    const [a, b] = twoTabs(20);
    const taken: number[] = [];
    const allocate = allocator('seq', taken);
    await Promise.all(Array.from({ length: 8 }, (_, i) => allocate(i % 2 ? b : a)));
    expect(taken).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('time spent waiting for the lock never counts as time spent hearing its holder', async () => {
    const [a, b] = twoTabs(20);
    const taken: number[] = [];
    const allocate = allocator('seq-held', taken);
    // b queues while a holds the lock past the hand-over budget.
    await Promise.all([allocate(a, 1100), allocate(b)]);
    expect(taken).toEqual([1, 2]);
  });
});
