/**
 * Session lifecycle: create → events → stop against the real API client;
 * `host` and `meta.recorder` ride the create, `boardUrl` passes through
 * untouched, and Stop drains before the PATCH done.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getState } from '../queue';
import { addAnnotation, addNote, RECORDER_ID, startSession, stopSession, togglePause } from '../session';
import { currentRoute, setTabIdentity } from '../state';
import { fakeLocation, freshRecorder, installStub, type Stub } from './stub';

let stub: Stub;

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation('https://app.example.test/orders/42?token=abc');
  setTabIdentity('tab-1', 'app.example.test');
  currentRoute.pathname = '/orders/42';
});
afterEach(() => stub.restore());

describe('session', () => {
  it('creates with host + web/ recorder meta, passes boardUrl through, drains, then PATCHes done', async () => {
    const rec = await startSession({ title: 'checkout' });
    const create = stub.calls.find((c) => c.path === '/api/v1/sessions' && c.method === 'POST')!;
    expect(create.body).toMatchObject({
      host: 'app.example.test',
      title: 'checkout',
      meta: { recorder: RECORDER_ID, platform: 'web' },
    });
    expect(RECORDER_ID.startsWith('web/')).toBe(true);
    expect(create.init.mode).toBe('cors');
    expect(rec.boardUrl).toBe('https://vitrinka.test/acme/b/example-session-1?x=1');

    addNote('looks off');
    addAnnotation('', { x: 10, y: 20, w: 30, h: 40 }, '#buy', { task: true });
    const done = await stopSession();
    const order = stub.calls.map((c) => `${c.method} ${c.path.replace(/.*sess-1/, '')}`);
    expect(order.indexOf('POST /events')).toBeLessThan(order.indexOf('PATCH '));
    const events = (stub.calls.find((c) => c.path.endsWith('/events'))!.body as { events: Record<string, unknown>[] }).events;
    expect(events.map((e) => e.kind)).toEqual(['nav', 'note', 'note']);
    expect(events[0]!.payload).toMatchObject({ route: '/orders/42' });
    expect(events[1]).toMatchObject({ tabId: 'tab-1', tabHost: 'app.example.test', payload: { text: 'looks off', route: '/orders/42' } });
    expect(events[2]!.payload).toMatchObject({ annotate: true, selector: '#buy', task: true, rect: { x: 10, y: 20, w: 30, h: 40 } });
    const patch = stub.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ status: 'done' });
    expect(done?.board?.url).toBe('https://vitrinka.test/acme/b/example-session-1?x=1');
    expect(getState()).toBeNull();
  });

  it('pause PATCHes the status and freezes capture', async () => {
    await startSession();
    expect(await togglePause()).toBe(true);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'paused' });
    addNote('dropped');
    expect(await togglePause()).toBe(false);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'recording' });
  });

  it('refuses to stop while the server is unreachable and keeps the tail', async () => {
    await startSession();
    addNote('keep me');
    stub.script.events.push({ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: false, status: 503 });
    const { drainBuffer } = await import('../queue');
    // Short drain: the real one waits a minute.
    expect(await drainBuffer(1)).toBe(false);
    expect(getState()?.sessionId).toBe('sess-1');
  });
});

describe('recorder id', () => {
  it('pins RECORDER_VERSION to the package version', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    const { RECORDER_VERSION } = await import('../session');
    expect(RECORDER_VERSION).toBe(pkg.version);
  });
});
