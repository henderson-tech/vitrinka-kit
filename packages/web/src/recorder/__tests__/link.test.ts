/**
 * The device link wired to the recorder: the stored token is the bearer when
 * no key is passed, an explicit key wins, and a 401 forgets the link and ends
 * the session locally.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { api } from '../api';
import { bearerToken, clearLink, configureRecorder, LINK_KEY, readLink, storeLink, vitrinkaLinked } from '../config';
import { installUnauthorizedHandler, linkDevice } from '../link';
import { getState, setState } from '../queue';
import { getRecorderStorage } from '../storage';
import { BASE, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;
beforeEach(() => {
  stub = installStub();
  freshRecorder();
  configureRecorder({ url: BASE });
});
afterEach(() => stub.restore());

describe('device link', () => {
  it('uses the stored link as the bearer; an explicit key wins', () => {
    expect(vitrinkaLinked()).toBe(false);
    expect(bearerToken()).toBe('');
    storeLink({ token: 'vkr_linked', workspace: 'acme', label: 'Safari', expires_in: 0 });
    expect(getRecorderStorage().getString(LINK_KEY)).toContain('vkr_linked');
    expect(vitrinkaLinked()).toBe(true);
    expect(bearerToken()).toBe('vkr_linked');
    configureRecorder({ url: BASE, key: 'vkr_explicit' });
    expect(bearerToken()).toBe('vkr_explicit');
    clearLink();
    expect(readLink()).toBeNull();
  });

  it('forgets the link and ends the session locally on a 401', async () => {
    storeLink({ token: 'vkr_dead', workspace: 'acme', label: 'Safari', expires_in: 0 });
    setState(liveSession());
    const off = installUnauthorizedHandler();
    stub.script.events.push({ ok: false, status: 401 });
    await expect(api('POST', '/api/v1/sessions/sess-1/events', { events: [] })).rejects.toThrow();
    expect(stub.calls[0]?.headers.authorization).toBe('Bearer vkr_dead');
    expect(readLink()).toBeNull();
    expect(getState()).toBeNull();
    off();
  });

  it('preselects the /w/<slug> of its url and discards a token approved into another workspace', async () => {
    configureRecorder({ url: `${BASE}/w/fixit`, label: 'Chrome on macOS' });
    const linkFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith('/claim')
        ? new Response(JSON.stringify({ token: 'vkr_turena', kind: 'recorder', workspace: 'turena', label: 'l', expires_in: 1 }), { status: 200 })
        : new Response(JSON.stringify({ device_code: 'dc', user_code: 'ABCD-EFGH', verify_path: '/cli-auth?code=ABCD-EFGH', qr_path: '/cli-auth/qr?code=ABCD-EFGH' }), {
            status: 201,
          })) as typeof fetch;
    try {
      const flow = await linkDevice();
      expect(flow.start.verifyUrl).toBe(`${BASE}/cli-auth?code=ABCD-EFGH&workspace=fixit`);
      await expect(flow.linked).rejects.toThrow('linked into turena — this app records into fixit; link again and pick fixit');
      expect(readLink()).toBeNull();
    } finally {
      globalThis.fetch = linkFetch;
    }
  });
});
