/**
 * `/recorder/me` and the HUD prefs: a linked device takes the server's prefs
 * and PATCHes changes back; a key build (409), a server too old for the route
 * (404) and an offline one keep them on the device — said once, never shown.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { configureRecorder } from '../config';
import { __resetMeForTests, cachedPrefs, fetchMe, savePrefs } from '../me';
import { getRecorderStorage } from '../storage';
import { BASE, freshRecorder } from './stub';

type Answer = { status: number; body?: unknown; gate?: Promise<void> } | 'network';

let answers: Answer[];
let calls: { method: string; path: string; body: unknown; auth: string }[];
const orig = globalThis.fetch;

beforeEach(() => {
  freshRecorder();
  answers = [];
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      method: init.method ?? 'GET',
      path: url.slice(BASE.length),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      auth: new Headers(init.headers).get('authorization') ?? '',
    });
    const a = answers.shift() ?? { status: 404 };
    if (a === 'network') throw new TypeError('Failed to fetch');
    if (a.gate) await a.gate;
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = orig;
});

const me = (prefs: unknown, kind = 'linked') => ({
  status: 200,
  body: {
    kind,
    workspace: { slug: 'acme', name: 'ADF' },
    user: kind === 'linked' ? { email: 'lukas@example.test', name: 'Lukáš' } : null,
    project: kind === 'key' ? 'web' : null,
    label: 'Chrome on macOS',
    prefs,
  },
});

describe('recorder/me', () => {
  it('a linked device takes the server prefs and PATCHes a change back', async () => {
    answers.push(me({ size: 'lg', verbose: true }));
    const account = await fetchMe();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/recorder/me', auth: 'Bearer vkr_test' });
    expect(account?.user?.email).toBe('lukas@example.test');
    expect(cachedPrefs()).toEqual({ size: 'lg', verbose: true, sheetW: 0, sheetH: 0 });
    answers.push(me({ size: 'sm', verbose: true }));
    expect(await savePrefs({ size: 'sm' })).toEqual({ size: 'sm', verbose: true, sheetW: 0, sheetH: 0 });
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: { prefs: { size: 'sm' } } });
    expect(JSON.parse(getRecorderStorage().getString('prefs') ?? '{}')).toEqual({ size: 'sm', verbose: true, sheetW: 0, sheetH: 0 });
  });

  it('a key build keeps prefs local: null prefs leave the cache, a PATCH 409 keeps the change', async () => {
    getRecorderStorage().set('prefs', JSON.stringify({ size: 'sm', verbose: false }));
    answers.push(me(null, 'key'));
    expect((await fetchMe())?.kind).toBe('key');
    expect(cachedPrefs()).toEqual({ size: 'sm', verbose: false, sheetW: 0, sheetH: 0 });
    // The cached key account skips the PATCH; an unknown one that answers 409 keeps it too.
    expect(await savePrefs({ verbose: true })).toEqual({ size: 'sm', verbose: true, sheetW: 0, sheetH: 0 });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    freshRecorder();
    answers.push({ status: 409, body: { error: 'key build' } });
    expect(await savePrefs({ size: 'lg' })).toEqual({ size: 'lg', verbose: false, sheetW: 0, sheetH: 0 });
  });

  it('a 404 or an offline server falls back to the device silently, warning once', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    getRecorderStorage().set('prefs', JSON.stringify({ size: 'lg', verbose: false }));
    answers.push({ status: 404 });
    expect(await fetchMe()).toBeNull();
    expect(cachedPrefs()).toEqual({ size: 'lg', verbose: false, sheetW: 0, sheetH: 0 });
    expect(await savePrefs({ verbose: true })).toEqual({ size: 'lg', verbose: true, sheetW: 0, sheetH: 0 });
    expect(calls).toHaveLength(1); // the route is known missing: no PATCH
    freshRecorder();
    answers.push('network');
    expect(await fetchMe()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2); // once per document (two fresh recorders)
    warn.mockRestore();
  });

  it('a slow GET or PATCHes answering out of order never revert the newest edit', async () => {
    const held = () => {
      let release = () => undefined as void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      return { gate, release };
    };
    const slowGet = held();
    answers.push({ ...me({ size: 'sm', verbose: false }), gate: slowGet.gate });
    const get = fetchMe(); // the menu opened…
    const slowPatch = held();
    answers.push({ ...me({ size: 'lg', verbose: false }), gate: slowPatch.gate });
    const first = savePrefs({ size: 'lg' }); // …the tester picks L, then M
    answers.push(me({ size: 'md', verbose: false }));
    await savePrefs({ size: 'md' });
    slowPatch.release();
    await first;
    slowGet.release();
    expect((await get)?.user?.email).toBe('lukas@example.test'); // the account still lands
    expect(cachedPrefs().size).toBe('md');
  });

  it('normalizes sheet dimensions from storage and takes a linked server copy', async () => {
    for (const value of [-1, '440', null, undefined]) {
      getRecorderStorage().set('prefs', JSON.stringify({ sheetW: value, sheetH: value }));
      __resetMeForTests();
      expect(cachedPrefs()).toMatchObject({ sheetW: 0, sheetH: 0 });
    }
    answers.push(me({ sheetW: 520, sheetH: 460 }));
    await fetchMe();
    expect(cachedPrefs()).toMatchObject({ sheetW: 520, sheetH: 460 });
  });

  it('applies sheet prefs before PATCH settles, stores them for reload, and splits mixed edits', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    answers.push({ ...me({ size: 'lg', sheetW: 540, sheetH: 470 }), gate });
    answers.push(me({ size: 'lg', sheetW: 540, sheetH: 470 }));
    const saving = savePrefs({ size: 'lg', sheetW: 540, sheetH: 470 });
    expect(cachedPrefs()).toMatchObject({ size: 'lg', sheetW: 540, sheetH: 470 });
    expect(JSON.parse(getRecorderStorage().getString('prefs')!)).toMatchObject({ sheetW: 540, sheetH: 470 });
    release();
    await saving;
    expect(calls.map((call) => call.body)).toEqual([
      { prefs: { size: 'lg' } }, { prefs: { sheetW: 540, sheetH: 470 } },
    ]);
    __resetMeForTests();
    expect(cachedPrefs()).toMatchObject({ size: 'lg', sheetW: 540, sheetH: 470 });
  });

  it('latches a sheet 422 locally without retries or losing size and verbose sync', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      answers.push({ status: 422, body: { error: 'unknown prefs.sheetW' } });
      await savePrefs({ sheetW: 540, sheetH: 470 });
      await savePrefs({ sheetW: 560, sheetH: 490 });
      expect(calls).toHaveLength(1);
      answers.push(me({ size: 'lg', verbose: true }));
      await savePrefs({ size: 'lg', verbose: true });
      expect(calls[1]!.body).toEqual({ prefs: { size: 'lg', verbose: true } });
      answers.push(me({ size: 'lg', verbose: true }));
      await fetchMe();
      expect(cachedPrefs()).toEqual({ size: 'lg', verbose: true, sheetW: 560, sheetH: 490 });
    } finally { warn.mockRestore(); }
  });

  it('asks nothing when the device is not linked', async () => {
    configureRecorder({ url: BASE });
    expect(await fetchMe()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
