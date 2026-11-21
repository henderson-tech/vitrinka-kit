/**
 * The test round a browser holds (vt-3094): the first report is handed a
 * token, the next ones send it, vitrinka decides when a new round opens, and
 * End round forgets the token once vitrinka closed the round.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { configureRecorder } from '../../recorder/config';
import { __resetStorageForTests, configureRecorderStorage, getRecorderStorage, memoryRecorderStorage } from '../../recorder/storage';
import { endRound, forgetRound, keepRound, roundFor, roundStorageKey } from '../round';
import { EMPTY_CAPTURE, type ReportEnvelope, ReportJob } from '../wire';

const BASE = 'https://vitrinka.test';
const TARGET = { url: BASE, key: 'vkb_test' };
const OTHER = { url: BASE, key: 'vkb_other' };

interface Seen {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

let seen: Seen[] = [];
let answer: (path: string, body: Record<string, unknown>) => Response = () => new Response('{}', { status: 404 });
const realFetch = globalThis.fetch;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

beforeEach(() => {
  seen = [];
  forgetRound(TARGET);
  forgetRound(OTHER);
  configureRecorder({ url: BASE, key: 'vkb_test' });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.slice(BASE.length);
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    seen.push({ method: init.method ?? 'GET', path, body });
    if (path.endsWith('/submit')) return json({ status: 'quarantined' });
    return answer(path, body);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function envelope(round?: string): ReportEnvelope {
  return {
    description: 'The service field resets',
    env: { url: 'https://app.example.test/sites/7', ua: 'test', viewport: { w: 1280, h: 800, dpr: 1 }, appVersion: '', locale: 'en' },
    console: [],
    network: [],
    markers: [],
    locale: 'en',
    ...(round ? { round } : {}),
  };
}

const send = (round?: string) => new ReportJob(EMPTY_CAPTURE, 'app.example.test', TARGET).run(envelope(round));
const created = () => seen.filter((c) => c.path === '/api/v1/reports').map((c) => c.body);

describe('the test round a browser holds', () => {
  it('keeps the token the first report is handed and the count each reply gives', async () => {
    expect(roundFor(TARGET)).toBeNull();
    answer = () => json({ id: 'rep-1', custody: 'quarantined', round: { token: 'rnd_a', reports: 1, openedAt: '2026-11-21T14:00:00Z' } }, 201);
    await send();
    expect(created()[0]).not.toHaveProperty('round');
    expect(roundFor(TARGET)).toEqual({ token: 'rnd_a', reports: 1, openedAt: '2026-11-21T14:00:00Z' });

    answer = () => json({ id: 'rep-2', custody: 'quarantined', round: { token: 'rnd_a', reports: 2, openedAt: '2026-11-21T14:00:00Z' } }, 201);
    await send(roundFor(TARGET)!.token);
    expect(created()[1]!.round).toBe('rnd_a');
    expect(roundFor(TARGET)!.reports).toBe(2);
    // Another project's widget on the same site holds its own round.
    expect(roundFor(OTHER)).toBeNull();
  });

  it('takes the new round vitrinka opens in place of one that ended or went quiet', async () => {
    keepRound(TARGET, { token: 'rnd_old', reports: 4 });
    answer = () => json({ id: 'rep-5', custody: 'quarantined', round: { token: 'rnd_new', reports: 1, rotated: true } }, 201);
    await send('rnd_old');
    expect(roundFor(TARGET)).toEqual({ token: 'rnd_new', reports: 1, openedAt: '' });
    expect(keepRound(TARGET, { token: 'rnd_newer', rotated: true }, 'rnd_new')).toEqual({ round: { token: 'rnd_newer', reports: 1, openedAt: '' }, rotated: true });
  });

  it('a reply without a round leaves the held one alone', async () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 2 });
    answer = () => json({ id: 'rep-3', custody: 'quarantined' }, 201);
    await send('rnd_a');
    expect(roundFor(TARGET)!.token).toBe('rnd_a');
    expect(keepRound(TARGET, { reports: 3 })).toBeNull();
    expect(keepRound(TARGET, 'rnd_a')).toBeNull();
  });

  it('a vitrinka before test rounds refuses the field by name: the report goes again without it, once', async () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 2 });
    answer = (_path, body) =>
      'round' in body
        ? json({ error: 'invalid JSON body: json: unknown field "round"; accepted top-level fields: title, description, env' }, 400)
        : json({ id: 'rep-9', custody: 'quarantined' }, 201);
    const reply = await send('rnd_a');
    expect(reply.status).toBe('quarantined');
    expect(created().map((b) => 'round' in b)).toEqual([true, false]);
  });

  it('End round forgets the token once vitrinka closed the round, or no longer knows it', async () => {
    expect(await endRound(TARGET)).toBe(false);
    expect(seen).toEqual([]);

    keepRound(TARGET, { token: 'rnd_a', reports: 2 });
    answer = () => json({ ended: true, how: 'ended' });
    expect(await endRound(TARGET)).toBe(true);
    expect(seen.at(-1)).toEqual({ method: 'POST', path: '/api/v1/report/round/end', body: { round: 'rnd_a' } });
    expect(roundFor(TARGET)).toBeNull();

    keepRound(TARGET, { token: 'rnd_gone', reports: 1 });
    answer = () => json({ error: 'no round of this project carries that token' }, 404);
    expect(await endRound(TARGET)).toBe(true);
    expect(roundFor(TARGET)).toBeNull();
  });

  it('End round forgets only the round it ended: one another tab was handed meanwhile stays', async () => {
    keepRound(TARGET, { token: 'rnd_old', reports: 3 });
    answer = () => {
      // While the request is in flight another tab's report rotates the round.
      keepRound(TARGET, { token: 'rnd_new', reports: 1, rotated: true }, 'rnd_old');
      return json({ ended: true, how: 'ended' });
    };
    expect(await endRound(TARGET)).toBe(true);
    expect(roundFor(TARGET)).toEqual({ token: 'rnd_new', reports: 1, openedAt: '' });
  });

  it('reads whatever the store holds without trusting it', () => {
    const s = getRecorderStorage();
    const key = roundStorageKey(TARGET);
    // A count that is no number — even one whose conversion would throw — is no count.
    s.set(key, JSON.stringify({ token: 'rnd_a', reports: { valueOf: 1, toString: 1 }, openedAt: 7 }));
    expect(roundFor(TARGET)).toEqual({ token: 'rnd_a', reports: 0, openedAt: '' });
    for (const bad of ['"rnd_a"', '[]', 'null', '{"token": 5}', 'not json']) {
      s.set(key, bad);
      expect(roundFor(TARGET)).toBeNull();
    }
    s.remove(key);
  });

  it('a create’s late reply never restores a round the browser moved on from', async () => {
    keepRound(TARGET, { token: 'rnd_old', reports: 2 });
    answer = () => {
      // While this tab's report (sent with rnd_old) is in flight, another tab's report rotates the round…
      keepRound(TARGET, { token: 'rnd_new', reports: 1, rotated: true }, 'rnd_old');
      // …and this one's reply, for the old round, arrives after.
      return json({ id: 'rep-7', custody: 'quarantined', round: { token: 'rnd_old', reports: 3 } }, 201);
    };
    await send('rnd_old');
    expect(roundFor(TARGET)).toEqual({ token: 'rnd_new', reports: 1, openedAt: '' });
    // A first report whose reply lands after another tab's first report keeps that tab's round too.
    forgetRound(TARGET);
    answer = () => {
      keepRound(TARGET, { token: 'rnd_first', reports: 1 });
      return json({ id: 'rep-8', custody: 'quarantined', round: { token: 'rnd_second', reports: 1 } }, 201);
    };
    await send();
    expect(roundFor(TARGET)!.token).toBe('rnd_first');
  });

  it('two replies for the round still held keep the higher count, whichever lands last', () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 1 });
    keepRound(TARGET, { token: 'rnd_a', reports: 3 }, 'rnd_a');
    keepRound(TARGET, { token: 'rnd_a', reports: 2 }, 'rnd_a');
    expect(roundFor(TARGET)!.reports).toBe(3);
  });

  it('two projects on one site keep separate keys: neither rewrites the other’s round', () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 1 });
    keepRound(OTHER, { token: 'rnd_b', reports: 4 });
    expect(roundStorageKey(TARGET)).not.toBe(roundStorageKey(OTHER));
    forgetRound(TARGET);
    expect(roundFor(TARGET)).toBeNull();
    expect(roundFor(OTHER)).toEqual({ token: 'rnd_b', reports: 4, openedAt: '' });
  });

  it('a store that refuses the write never costs the report: the round is simply not kept', async () => {
    const mem = memoryRecorderStorage();
    let full = false;
    __resetStorageForTests();
    configureRecorderStorage({
      ...mem,
      set: (k, v) => {
        if (full) throw new DOMException('quota exceeded', 'QuotaExceededError');
        mem.set(k, v);
      },
    });
    try {
      full = true;
      answer = () => json({ id: 'rep-1', custody: 'quarantined', round: { token: 'rnd_a', reports: 1 } }, 201);
      const reply = await send();
      expect(reply.status).toBe('quarantined');
      expect(roundFor(TARGET)).toBeNull();
    } finally {
      __resetStorageForTests();
      configureRecorderStorage(memoryRecorderStorage());
    }
  });

  it('End round keeps the token when vitrinka could not be reached, so it can be pressed again', async () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 2 });
    answer = () => new Response('unavailable', { status: 503 });
    await expect(endRound(TARGET)).rejects.toThrow('503');
    expect(roundFor(TARGET)!.token).toBe('rnd_a');
  });
});
