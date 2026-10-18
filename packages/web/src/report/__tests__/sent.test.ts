/**
 * What this browser sent (vt-8020 D4): newest first, capped, scoped to the
 * vitrinka base and the page's host; a reporter session is live only while it
 * has more than a minute left.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { sessionLive } from '../reader';
import { MAX_SENT, noteSent, readSent } from '../sent';

// bun test runs without a DOM: an in-memory Storage stands in for the browser's.
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

describe('sent reports', () => {
  it('lists newest first and keeps at most MAX_SENT', () => {
    for (let i = 0; i < MAX_SENT + 3; i++) noteSent('https://v.test', 'app.test', { title: `r${i}`, at: i, status: 'filed' });
    const rows = readSent('https://v.test', 'app.test');
    expect(rows).toHaveLength(MAX_SENT);
    expect(rows[0]?.title).toBe(`r${MAX_SENT + 2}`);
  });

  it('keeps each base and host to itself', () => {
    noteSent('https://v.test', 'a.test', { title: 'a', at: 1, status: 'quarantined' });
    expect(readSent('https://v.test', 'b.test')).toEqual([]);
    expect(readSent('https://w.test', 'a.test')).toEqual([]);
  });
});

describe('sessionLive', () => {
  it('is false within the last minute and for no session', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const s = { reporter: { id: 'r', email: 'a@b.c' }, session: 's', expiresAt: '2026-10-18T12:00:30Z' };
    expect(sessionLive(s, now)).toBe(false);
    expect(sessionLive({ ...s, expiresAt: '2026-10-18T12:10:00Z' }, now)).toBe(true);
    expect(sessionLive(null, now)).toBe(false);
  });
});
