/**
 * The test round a browser holds (vt-3094): the first report is handed a
 * token, the next ones send it, vitrinka decides when a new round opens, and
 * End round forgets the token once vitrinka closed the round.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { configureRecorder } from '../../recorder/config';
import { endRound, forgetRound, keepRound, roundFor } from '../round';
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
    expect(keepRound(TARGET, { token: 'rnd_newer', rotated: true })).toEqual({ round: { token: 'rnd_newer', reports: 1, openedAt: '' }, rotated: true });
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

  it('End round keeps the token when vitrinka could not be reached, so it can be pressed again', async () => {
    keepRound(TARGET, { token: 'rnd_a', reports: 2 });
    answer = () => new Response('unavailable', { status: 503 });
    await expect(endRound(TARGET)).rejects.toThrow('503');
    expect(roundFor(TARGET)!.token).toBe('rnd_a');
  });
});
