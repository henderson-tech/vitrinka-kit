/**
 * Session lifecycle: create → events → stop against the real API client;
 * `host` and `meta.recorder` ride the create, `boardUrl` passes through
 * untouched, and Stop drains before the PATCH done.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { currentRules } from '../capture/redact';
import { configureRecorder } from '../config';
import { __resetForTests, adoptStoredState, getState, markStopping, STOPPING_TTL_MS } from '../queue';
import { addAnnotation, addNote, followOtherTabs, RECORDER_ID, startSession, stopSession, togglePause } from '../session';
import { currentRoute, setTabIdentity } from '../state';
import { __resetStorageForTests, configureRecorderStorage, getRecorderStorage, memoryRecorderStorage } from '../storage';
import { BASE, fakeLocation, freshRecorder, installStub, liveSession, type Stub } from './stub';

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
      meta: { recorder: RECORDER_ID, platform: 'web', devicePixelRatio: 1 },
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

  it('scrubs URL secrets from the start URL before its nav is queued', async () => {
    fakeLocation('https://app.example.test/reset?token=hunter2&lang=cs#access_token=at-1');
    await startSession();
    await stopSession();
    const events = (stub.calls.find((c) => c.path.endsWith('/events'))!.body as { events: Record<string, unknown>[] }).events;
    expect(events[0]).toMatchObject({
      kind: 'nav',
      payload: { url: 'https://app.example.test/reset?token=[redacted]&lang=cs#access_token=[redacted]' },
    });
  });

  it('names the configured project on create, and omits it when unset', async () => {
    await startSession();
    const bare = stub.calls.find((c) => c.path === '/api/v1/sessions' && c.method === 'POST')!;
    expect(bare.body).not.toHaveProperty('project');
    await stopSession();

    configureRecorder({ url: BASE, project: 'powerflow' });
    await startSession();
    const named = stub.calls.filter((c) => c.path === '/api/v1/sessions' && c.method === 'POST').at(-1)!;
    expect(named.body).toMatchObject({ host: 'app.example.test', project: 'powerflow' });
  });

  it('pause PATCHes the status and freezes capture', async () => {
    await startSession();
    expect(await togglePause()).toBe(true);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'paused' });
    addNote('dropped');
    expect(await togglePause()).toBe(false);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'recording' });
  });

  it('follows another tab through the shared store: joins its recording, applies the policy written after it, ends with its Stop', () => {
    const shared = memoryRecorderStorage();
    const watchers = new Map<string, (value: string | null) => void>();
    __resetStorageForTests();
    configureRecorderStorage({
      ...shared,
      watch: (key, onChange) => {
        watchers.set(key, onChange);
        return () => void watchers.delete(key);
      },
    });
    __resetForTests();
    const otherTab = (key: string, value: string | null) => {
      if (value === null) shared.remove(key);
      else shared.set(key, value);
      watchers.get(key)?.(value);
    };
    const unfollow = followOtherTabs();
    const started = { ...liveSession(), sessionId: 'sess-9', seq: 1 };
    otherTab('rec', JSON.stringify(started));
    expect(getState()?.sessionId).toBe('sess-9');
    // The starting tab writes the workspace policy only after its first record.
    otherTab('rec', JSON.stringify({ ...started, seq: 2, policy: { patterns: ['acme_[0-9]+'] } }));
    expect(currentRules().patterns.map(String)).toContain('/acme_[0-9]+/g');
    otherTab('rec', null);
    expect(getState()).toBeNull();
    expect(currentRules().patterns.map(String)).not.toContain('/acme_[0-9]+/g');
    unfollow();
  });

  it('a Stop that finishes after another tab moved on to a new session leaves that session running', async () => {
    await startSession();
    const stopping = stopSession();
    // While the stop drains, another tab starts sess-2 and this tab follows it.
    adoptStoredState(JSON.stringify({ ...liveSession(), sessionId: 'sess-2' }));
    await stopping;
    expect(stub.calls.find((c) => c.method === 'PATCH')?.path).toBe('/api/v1/sessions/sess-1');
    expect(getState()?.sessionId).toBe('sess-2');
  });

  it('while a Stop is out, the other tabs read the session paused at the Stop; a stop that keeps it hands it back', async () => {
    await startSession();
    const stored = () => JSON.parse(getRecorderStorage().getString('rec') ?? 'null') as Record<string, unknown> | null;
    stub.script.patch.push({ ok: false, status: 503 });
    const stopping = stopSession();
    expect(stored()).toMatchObject({ sessionId: 'sess-1', paused: true, resumeAt: null, stopping: expect.any(String) });
    // Another tab writes its frozen copy back (its policy fetch landed): this tab keeps capturing,
    // so the tail its Stop drains still lands.
    adoptStoredState(JSON.stringify({ ...stored(), policy: null }));
    expect(getState()).toMatchObject({ paused: false, policy: null });
    expect(getState()?.stopping).toBeUndefined();
    await expect(stopping).rejects.toThrow();
    expect(stored()).toMatchObject({ sessionId: 'sess-1', paused: false });
    expect(stored()?.stopping).toBeUndefined();
  });

  it('a stopping mark refuses pause and resume until it is stale: the tab that wrote it is gone, and it is a plain pause', async () => {
    await startSession();
    const frozen = { ...getState()!, paused: true, resumeAt: null };
    adoptStoredState(JSON.stringify({ ...frozen, stopping: new Date().toISOString() }));
    expect(await togglePause()).toBe(false);
    expect(getState()).toMatchObject({ paused: true });
    adoptStoredState(JSON.stringify({ ...frozen, stopping: new Date(Date.now() - STOPPING_TTL_MS).toISOString() }));
    expect(await togglePause()).toBe(false); // resumed: no longer paused
    expect(getState()).toMatchObject({ paused: false });
    expect(getState()?.stopping).toBeUndefined();
  });

  it('the stopping mark is a lease renewed while the Stop is out, so a hung request is never taken for a gone tab', async () => {
    await startSession();
    const mark = () => (JSON.parse(getRecorderStorage().getString('rec') ?? 'null') as { stopping?: string } | null)?.stopping;
    markStopping('sess-1', 0, 5);
    const first = Date.parse(mark() ?? '');
    await new Promise((res) => setTimeout(res, 30));
    expect(Date.parse(mark() ?? '')).toBeGreaterThan(first);
    markStopping(null);
    await new Promise((res) => setTimeout(res, 30));
    expect(mark()).toBeUndefined();
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
