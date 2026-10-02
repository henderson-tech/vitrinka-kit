/**
 * `/recorder/me` and the HUD prefs: a linked device takes the server's prefs
 * and PATCHes changes back; a key build (409), a server too old for the route
 * (404) and an offline one keep them on the device — said once, never shown.
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { configureRecorder } from '../config';
import { cachedPrefs, fetchMe, savePrefs } from '../me';
import { getRecorderStorage } from '../storage';
import { BASE, freshRecorder } from './stub';

type Answer = { status: number; body?: unknown } | 'network';

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
    expect(cachedPrefs()).toEqual({ size: 'lg', verbose: true });
    answers.push(me({ size: 'sm', verbose: true }));
    expect(await savePrefs({ size: 'sm' })).toEqual({ size: 'sm', verbose: true });
    expect(calls[1]).toMatchObject({ method: 'PATCH', body: { prefs: { size: 'sm' } } });
    expect(JSON.parse(getRecorderStorage().getString('prefs') ?? '{}')).toEqual({ size: 'sm', verbose: true });
  });

  it('a key build keeps prefs local: null prefs leave the cache, a PATCH 409 keeps the change', async () => {
    getRecorderStorage().set('prefs', JSON.stringify({ size: 'sm', verbose: false }));
    answers.push(me(null, 'key'));
    expect((await fetchMe())?.kind).toBe('key');
    expect(cachedPrefs()).toEqual({ size: 'sm', verbose: false });
    // The cached key account skips the PATCH; an unknown one that answers 409 keeps it too.
    expect(await savePrefs({ verbose: true })).toEqual({ size: 'sm', verbose: true });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    freshRecorder();
    answers.push({ status: 409, body: { error: 'key build' } });
    expect(await savePrefs({ size: 'lg' })).toEqual({ size: 'lg', verbose: false });
  });

  it('a 404 or an offline server falls back to the device silently, warning once', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    getRecorderStorage().set('prefs', JSON.stringify({ size: 'lg', verbose: false }));
    answers.push({ status: 404 });
    expect(await fetchMe()).toBeNull();
    expect(cachedPrefs()).toEqual({ size: 'lg', verbose: false });
    expect(await savePrefs({ verbose: true })).toEqual({ size: 'lg', verbose: true });
    expect(calls).toHaveLength(1); // the route is known missing: no PATCH
    freshRecorder();
    answers.push('network');
    expect(await fetchMe()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2); // once per document (two fresh recorders)
    warn.mockRestore();
  });

  it('asks nothing when the device is not linked', async () => {
    configureRecorder({ url: BASE });
    expect(await fetchMe()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
