/**
 * The durable queue: seq order and never-drop across a simulated reload,
 * transient-vs-permanent verdicts, and the rrweb chunk lane (upload first,
 * event row with the pre-allocated seq + blobKey after).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  __bufferForTests,
  __chunksForTests,
  __dropCachesForTests,
  flush,
  getState,
  health,
  pushEvent,
  pushRRWebBatch,
  setState,
  splitRRWebEvents,
} from '../queue';
import { freshRecorder, installStub, liveSession, ROUTE, type Stub } from './stub';

let stub: Stub;

beforeEach(() => {
  stub = installStub();
  freshRecorder();
});
afterEach(() => stub.restore());

const eventsPosts = () => stub.calls.filter((c) => c.path.endsWith('/events'));
const batchSeqs = (c: { body: unknown }) => (c.body as { events: { seq: number }[] }).events.map((e) => e.seq);

describe('queue', () => {
  it('keeps seq order and never drops across a reload of the storage driver', async () => {
    setState(liveSession());
    pushEvent('click', { selector: '#a' }, ROUTE);
    pushEvent('click', { selector: '#b' }, ROUTE);
    pushEvent('nav', { url: '/x' }, ROUTE);
    // A reload: in-memory caches gone, storage intact (persistNow ran on pagehide).
    const { persistNow } = await import('../queue');
    persistNow();
    __dropCachesForTests();
    expect(getState()?.seq).toBe(3);
    pushEvent('note', { text: 'after reload' }, ROUTE);
    expect(await flush()).toBe(true);
    const posts = eventsPosts();
    expect(posts).toHaveLength(1);
    expect(batchSeqs(posts[0]!)).toEqual([1, 2, 3, 4]);
    expect(__bufferForTests()).toHaveLength(0);
    expect(posts[0]!.headers.authorization).toBe('Bearer vkr_test');
    expect(posts[0]!.init.credentials).toBe('omit');
  });

  it('keeps the buffer on a transient failure and schedules a retry', async () => {
    setState(liveSession());
    pushEvent('click', {}, ROUTE);
    stub.script.events.push({ ok: false, status: 503 });
    expect(await flush()).toBe(false);
    expect(__bufferForTests()).toHaveLength(1);
    expect(health().failures).toBe(1);
    expect(getState()?.dead).toBeUndefined();
    expect(await flush()).toBe(true);
    expect(__bufferForTests()).toHaveLength(0);
    expect(health().synced).toBe(true);
  });

  it('marks the session dead on a permanent verdict and stops flushing', async () => {
    setState(liveSession());
    pushEvent('click', {}, ROUTE);
    stub.script.events.push({ ok: false, status: 401 });
    expect(await flush()).toBe(false);
    expect(getState()?.dead).toBe(true);
    expect(health().state).toBe('dead');
    expect(await flush()).toBe(false);
    expect(eventsPosts()).toHaveLength(1);
    // Capture stops too.
    expect(pushEvent('click', {}, ROUTE)).toBeNull();
  });

  it('drops events while paused and when no session is live', () => {
    expect(pushEvent('click', {}, ROUTE)).toBeNull();
    setState(liveSession(true));
    expect(pushEvent('click', {}, ROUTE)).toBeNull();
    expect(pushRRWebBatch([{ type: 4 }], ROUTE)).toBe(0);
  });

  it('uploads rrweb chunks under a pre-allocated seq, then the event row carries the blobKey', async () => {
    setState(liveSession());
    pushEvent('nav', { url: '/' }, ROUTE); // seq 1
    expect(pushRRWebBatch([{ type: 4, data: {} }, { type: 2, data: {} }], ROUTE)).toBe(1); // seq 2
    pushEvent('click', {}, ROUTE); // seq 3
    expect(__chunksForTests()).toEqual([{ seq: 2, count: 2, sessionId: 'sess-1' }]);
    expect(await flush()).toBe(true);
    const chunkCall = stub.calls.find((c) => c.path.includes('/chunk?seq='));
    expect(chunkCall?.path).toBe('/api/v1/sessions/sess-1/chunk?seq=2');
    expect(chunkCall?.headers['content-type']).toBe('application/json');
    expect(chunkCall?.body).toHaveLength(2); // the stub JSON-parses bodies
    // The chunk went up BEFORE the events POST, and its row rides in order.
    const order = stub.calls.map((c) => c.path.replace(/.*sess-1\//, ''));
    expect(order.indexOf('chunk?seq=2')).toBeLessThan(order.indexOf('events'));
    const posts = eventsPosts();
    expect(batchSeqs(posts[0]!)).toEqual([1, 3, 2]);
    const row = (posts[0]!.body as { events: { seq: number; kind: string; payload: unknown; blobKey?: string }[] })
      .events.find((e) => e.seq === 2);
    expect(row).toMatchObject({ kind: 'rrweb', payload: { count: 2 }, blobKey: 'blob-2' });
    expect(__chunksForTests()).toHaveLength(0);
  });

  it('retries a chunk on a transient failure and drops it on a permanent one', async () => {
    setState(liveSession());
    pushRRWebBatch([{ type: 4 }], ROUTE);
    stub.script.chunks.push({ ok: false, status: 502 });
    await flush();
    expect(__chunksForTests()).toHaveLength(1);
    stub.script.chunks.push({ ok: false, status: 413 });
    await flush();
    expect(__chunksForTests()).toHaveLength(0);
    expect(__bufferForTests().some((e) => e.kind === 'rrweb')).toBe(false);
  });

  it('splits rrweb batches under the pack margin and reports the undeliverable', () => {
    const big = { type: 2, data: 'x'.repeat(200) };
    const small = { type: 3, data: 'y' };
    const { parts, dropped } = splitRRWebEvents([small, big, small, { type: 2, data: 'z'.repeat(400) }], 100, 300);
    expect(dropped).toEqual([expect.any(Number)]);
    expect(parts.map((p) => p.count)).toEqual([1, 1, 1]);
    for (const p of parts) expect(() => JSON.parse(p.body)).not.toThrow();
  });
});
