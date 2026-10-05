/**
 * Session lifecycle: create → events → stop against the real API client;
 * `host` and `meta.recorder` ride the create, `boardUrl` passes through
 * untouched, and Stop drains before the PATCH done.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { currentRules } from '../capture/redact';
import { configureRecorder } from '../config';
import { __dropCachesForTests, __resetForTests, adoptStoredState, flush, getState, markStopping, persistNow, pushRRWebBatch, STOPPING_TTL_MS } from '../queue';
import { addAnnotation, addNote, followOtherTabs, onBeforeStop, RECORDER_ID, startSession, stopSession, togglePause } from '../session';
import { currentRoute, setTabIdentity } from '../state';
import { __resetStorageForTests, configureRecorderStorage, getRecorderStorage, memoryRecorderStorage } from '../storage';
import { registerRecorderTab, waitForRecorderPeers } from '../tabs';
import { BASE, fakeLocation, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;

function tabEvents() {
  const events = new EventTarget();
  const add = globalThis.addEventListener;
  const remove = globalThis.removeEventListener;
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: events.addEventListener.bind(events) });
  Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: events.removeEventListener.bind(events) });
  return { events, restore: () => {
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: add });
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: remove });
  } };
}

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

  it('Stop waits for captures awaiting the cross-tab seq lock before draining and closing', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    __resetStorageForTests();
    configureRecorderStorage({
      ...memoryRecorderStorage(),
      withLock: async (_name, run) => { await gate; run(); },
    });
    __resetForTests();
    await startSession();
    addNote('captured before Stop');
    let hooks = 0;
    const off = onBeforeStop(() => { hooks++; });
    const stopping = stopSession();
    await Bun.sleep(1);
    expect(stub.calls.some((call) => call.method === 'PATCH')).toBe(false);
    release();
    await stopping;
    off();
    expect(hooks).toBe(1);
    const events = (stub.calls.find((call) => call.path.endsWith('/events'))!.body as {
      events: { seq: number; payload: { text?: string } }[];
    }).events;
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(events[1]!.payload.text).toBe('captured before Stop');
    expect(getState()).toBeNull();
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

  it('ships the rrweb tail when an allocator observes Stop before its storage notification', async () => {
    const storage = memoryRecorderStorage();
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    __resetStorageForTests();
    configureRecorderStorage({ ...storage, withLock: async (_key, run) => { await gate; run(); } });
    __resetForTests();
    await startSession();
    const off = onBeforeStop(() => pushRRWebBatch([{ type: 3, data: { text: 'tail before Stop' } }], { tabId: 'tab-1', tabHost: 'app.example.test' }));
    storage.set('rec', JSON.stringify({ ...getState(), paused: true, stopping: new Date().toISOString() }));
    release();
    await flush();
    off();
    expect(stub.calls.some((call) => call.path.includes('/chunk?seq=') && JSON.stringify(call.body).includes('tail before Stop'))).toBe(true);
  });

  it('pause PATCHes the status and freezes capture', async () => {
    await startSession();
    expect(await togglePause()).toBe(true);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'paused' });
    addNote('dropped');
    expect(await togglePause()).toBe(false);
    expect(stub.calls.at(-1)?.body).toEqual({ status: 'recording' });
  });

  it('refuses Stop while a sibling has an unsaved tail and keeps this tab\'s captures', async () => {
    const shared = memoryRecorderStorage();
    __resetStorageForTests();
    configureRecorderStorage({ ...shared, watch: () => () => {} });
    __resetForTests();
    await startSession();
    addNote('local tail');
    shared.set('tab.sibling', JSON.stringify({ sessionId: 'sess-1', at: Date.now(), failed: true }));
    await expect(stopSession()).rejects.toThrow('another tab has undelivered captures');
    expect(getState()).toMatchObject({ sessionId: 'sess-1', paused: true });
    expect(stub.calls.some((call) => call.method === 'PATCH' && (call.body as { status?: string })?.status === 'done')).toBe(false);
    expect(shared.getString('buffer')).toContain('local tail');
  });

  it('leaving a page with captures pending keeps an unsaved participant instead of acknowledging delivery', async () => {
    const bus = tabEvents();
    const storage = memoryRecorderStorage();
    __resetStorageForTests();
    configureRecorderStorage({ ...storage, watch: () => () => {}, withLock: async () => { await new Promise<void>(() => {}); } });
    __resetForTests();
    await startSession();
    const tab = registerRecorderTab()!;
    try {
      addNote('tail on leaving');
      const key = storage.keys!().find((key) => key.startsWith('tab.'))!;
      bus.events.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(storage.getString(key) ?? 'null')).toMatchObject({ sessionId: 'sess-1', failed: true, departed: true });
    } finally { tab.dispose(); bus.restore(); }
  });

  it('keeps a reloaded assigned journal recoverable when departing under a held lock', async () => {
    const bus = tabEvents();
    const storage = memoryRecorderStorage();
    let held = false;
    __resetStorageForTests();
    configureRecorderStorage({ ...storage, watch: () => () => {}, withLock: async (_key, run) => {
      if (held) await new Promise<void>(() => {});
      run();
    } });
    __resetForTests();
    await startSession();
    addNote('assigned before reload');
    stub.script.events.push({ ok: false, status: 503 });
    expect(await flush()).toBe(false);
    persistNow();
    __dropCachesForTests();
    held = true;
    const tab = registerRecorderTab()!;
    try {
      const key = storage.keys!().find((key) => key.startsWith('tab.'))!;
      bus.events.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(storage.getString(key) ?? 'null')).toMatchObject({ departed: true, recoverable: true });
      held = false;
      expect(await flush()).toBe(true);
      expect(storage.getString(key)).toBeNull();
    } finally { tab.dispose(); bus.restore(); }
  });

  it('recovers a durable peer that departs after the Stop wait has started', async () => {
    const storage = memoryRecorderStorage();
    const watchers = new Map<string, (raw: string | null) => void>();
    __resetStorageForTests();
    configureRecorderStorage({
      ...storage,
      withLock: async (_key, run) => { run(); },
      remove: (key) => { storage.remove(key); watchers.get(key)?.(null); },
      watch: (key, check) => { watchers.set(key, check); return () => void watchers.delete(key); },
    });
    __resetForTests();
    await startSession();
    await flush();
    storage.set('tab.sibling', JSON.stringify({ sessionId: 'sess-1', at: Date.now() }));
    const waiting = waitForRecorderPeers(['tab.sibling'], 'sess-1', 1000);
    expect(watchers.has('tab.sibling')).toBe(true);
    storage.set('allocation.sibling.1', JSON.stringify({ draft: {
      sessionId: 'sess-1', ts: new Date().toISOString(), tabId: 'sibling', tabHost: 'app.example.test',
      kind: 'event', event: { kind: 'note', payload: { text: 'departed during Stop' } },
    } }));
    const departed = JSON.stringify({ sessionId: 'sess-1', at: Date.now(), failed: true, departed: true, recoverable: true });
    storage.set('tab.sibling', departed);
    watchers.get('tab.sibling')!(departed);
    expect(await waiting).toBe(true);
    expect(storage.getString('tab.sibling')).toBeNull();
    expect(stub.calls.some((call) => call.path.endsWith('/events') && JSON.stringify(call.body).includes('departed during Stop'))).toBe(true);
  });

  it('discovers a departed peer journal written after an in-flight flush scanned storage', async () => {
    const storage = memoryRecorderStorage();
    const watchers = new Map<string, (raw: string | null) => void>();
    __resetStorageForTests();
    configureRecorderStorage({
      ...storage,
      withLock: async (_key, run) => { run(); },
      remove: (key) => { storage.remove(key); watchers.get(key)?.(null); },
      watch: (key, check) => { watchers.set(key, check); return () => void watchers.delete(key); },
    });
    __resetForTests();
    await startSession();
    await flush();
    addNote('already flushing');
    let release = () => {};
    stub.gate = new Promise<void>((resolve) => { release = resolve; });
    const inFlight = flush();
    while (!stub.calls.some((call) => call.path.endsWith('/events') && JSON.stringify(call.body).includes('already flushing'))) await Bun.sleep(1);
    storage.set('tab.late-peer', JSON.stringify({ sessionId: 'sess-1', at: Date.now() }));
    const waiting = waitForRecorderPeers(['tab.late-peer'], 'sess-1', 3000);
    storage.set('allocation.late-peer.1', JSON.stringify({ draft: {
      sessionId: 'sess-1', ts: new Date().toISOString(), tabId: 'late-peer', tabHost: 'app.example.test',
      kind: 'event', event: { kind: 'note', payload: { text: 'written after scan' } },
    } }));
    const departed = JSON.stringify({ sessionId: 'sess-1', at: Date.now(), failed: true, departed: true, recoverable: true });
    storage.set('tab.late-peer', departed);
    watchers.get('tab.late-peer')!(departed);
    stub.gate = null;
    release();
    await inFlight;
    expect(await waiting).toBe(true);
    expect(storage.getString('tab.late-peer')).toBeNull();
    expect(stub.calls.some((call) => call.path.endsWith('/events') && JSON.stringify(call.body).includes('written after scan'))).toBe(true);
  });

  it('registers the restored document again after a back-forward cache pageshow', async () => {
    const bus = tabEvents();
    const storage = memoryRecorderStorage();
    __resetStorageForTests();
    configureRecorderStorage({ ...storage, watch: () => () => {} });
    __resetForTests();
    await startSession();
    await flush();
    const tab = registerRecorderTab()!;
    try {
      bus.events.dispatchEvent(new Event('pagehide'));
      expect(storage.keys!().filter((key) => key.startsWith('tab.'))).toHaveLength(0);
      bus.events.dispatchEvent(new Event('pageshow'));
      expect(storage.keys!().filter((key) => key.startsWith('tab.'))).toHaveLength(1);
    } finally { tab.dispose(); bus.restore(); }
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
