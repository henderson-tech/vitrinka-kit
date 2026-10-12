/**
 * Network lane: Authorization is redacted BEFORE the event is queued, the
 * recorder's own vitrinka traffic is never recorded, and a request that ends
 * after its session is not attributed to the next one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { __readBoundedTextForTests, __setBodyReadDeadlineForTests, patchNetwork } from '../capture/net';
import { __bufferForTests, capturesSettled, setState } from '../queue';
import { BASE, freshRecorder, installStub, liveSession, type Stub } from './stub';

let stub: Stub;

// patchNetwork wraps whatever fetch is installed at patch time — install the
// stub first so the wrapped original is the scripted transport.
beforeEach(() => {
  stub = installStub();
  freshRecorder();
  delete (globalThis as { __vitrinkaRecorderNetPatched?: boolean }).__vitrinkaRecorderNetPatched;
  patchNetwork();
});
afterEach(() => stub.restore());

const recorded = () => __bufferForTests().filter((e) => e.kind === 'net').map((e) => e.payload ?? {});

describe('net lane', () => {
  it('redacts the Authorization header and secret body keys before queueing', async () => {
    setState(liveSession());
    await fetch('https://api.example.test/login', {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cret', 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'lu', password: 'hunter2' }),
    });
    await capturesSettled();
    const [ev] = recorded();
    expect(ev).toMatchObject({ method: 'POST', url: 'https://api.example.test/login', via: 'fetch' });
    expect((ev!.reqHeaders as Record<string, string>).Authorization).not.toContain('s3cret');
    expect(String(ev!.reqBody)).not.toContain('hunter2');
    expect(String(ev!.reqBody)).toContain('"user":"lu"');
  });

  it('never records the recorder’s own vitrinka traffic', async () => {
    setState(liveSession());
    await fetch(`${BASE}/api/v1/sessions/sess-1/events`, { method: 'POST', body: '{}' });
    await capturesSettled();
    expect(recorded()).toHaveLength(0);
  });

  it('records nothing when no session is live', async () => {
    await fetch('https://api.example.test/x');
    await capturesSettled();
    expect(recorded()).toHaveLength(0);
  });
});

describe('net lane uninstall', () => {
  it('restores fetch and the XHR prototype on unpatch, and re-patches cleanly', async () => {
    const { unpatchNetwork } = await import('../capture/net');
    const patchedFetch = globalThis.fetch;
    unpatchNetwork();
    expect(globalThis.fetch).not.toBe(patchedFetch);
    // (bun has no XMLHttpRequest — the prototype restore rides the same restores list)
    // Nothing is recorded after unpatch, even with a live session.
    setState(liveSession());
    await fetch('https://api.example.test/after');
    await capturesSettled();
    expect(recorded()).toHaveLength(0);
    // And the mark is gone, so the next mount patches again.
    patchNetwork();
    await fetch('https://api.example.test/again');
    await capturesSettled();
    expect(recorded().map((e) => e.url)).toEqual(['https://api.example.test/again']);
  });

  it('leaves a global alone when someone else wrapped it after us', async () => {
    const foreign = (async () => new Response('x')) as unknown as typeof fetch;
    globalThis.fetch = foreign;
    const { unpatchNetwork } = await import('../capture/net');
    unpatchNetwork();
    expect(globalThis.fetch).toBe(foreign);
  });

  it('another recorder bundle\'s wrappers stay its own to remove, and a bundle that starts capturing takes them over (ONE recorder)', async () => {
    const { ownNetworkPatch, unpatchNetwork } = await import('../capture/net');
    unpatchNetwork();
    // The first bundle on the page installed its wrapper; it now follows, so it passes everything through.
    const g = globalThis as { __vitrinkaRecorderNetPatched?: unknown; __vitrinkaRecorderNetUnpatch?: () => void };
    const underneath = globalThis.fetch;
    const theirs = ((input: RequestInfo | URL, init?: RequestInit) => underneath(input, init)) as typeof fetch;
    globalThis.fetch = theirs;
    let theirUnpatch = 0;
    g.__vitrinkaRecorderNetPatched = {};
    g.__vitrinkaRecorderNetUnpatch = () => {
      theirUnpatch += 1;
      if (globalThis.fetch === theirs) globalThis.fetch = underneath;
      delete g.__vitrinkaRecorderNetPatched;
      delete g.__vitrinkaRecorderNetUnpatch;
    };
    unpatchNetwork();
    expect(theirUnpatch).toBe(0);
    expect(globalThis.fetch).toBe(theirs);
    // This bundle leads: its wrapper goes live in their place and records.
    ownNetworkPatch();
    expect(theirUnpatch).toBe(1);
    setState(liveSession());
    await fetch('https://api.example.test/led');
    await capturesSettled();
    expect(recorded().map((e) => e.url)).toEqual(['https://api.example.test/led']);
    ownNetworkPatch();
    await fetch('https://api.example.test/once');
    await capturesSettled();
    expect(recorded()).toHaveLength(2);
  });
});

// The bound is asserted on the RAW read (the capping wrapper would hide it):
// a stream that never ends stops at 512 KiB, a stalled one at the deadline, and
// a body whose declared length already exceeds the bound is never pulled.
describe('net lane bounded body read', () => {
  const LIMIT = 512 * 1024;

  it('stops pulling at the byte bound and marks the body truncated', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(97);
    let pulls = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls += 1;
        c.enqueue(chunk);
      },
    });
    const res = new Response(endless, { headers: { 'content-type': 'text/plain' } });
    const text = await __readBoundedTextForTests(res, res.headers);
    expect(text).toMatch(/…\[truncated at 524288 bytes\]$/);
    expect(text?.length ?? 0).toBeLessThanOrEqual(LIMIT + 40);
    // 8 chunks fill the bound; a few pulls of read-ahead are fine, hundreds are not.
    expect(pulls).toBeLessThanOrEqual(16);
  });

  it('gives a stalled stream up at the read deadline and keeps what arrived', async () => {
    const restore = __setBodyReadDeadlineForTests(40);
    try {
      const stalled = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('partial'));
          // never closes
        },
      });
      const res = new Response(stalled, { headers: { 'content-type': 'text/plain' } });
      const started = Date.now();
      const text = await __readBoundedTextForTests(res, res.headers);
      expect(text).toBe('partial…[body read timed out after 40ms]');
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      restore();
    }
  });

  it('omits a body whose declared length exceeds the bound without reading it', async () => {
    const headers = new Headers({ 'content-length': String(10 * 1024 * 1024), 'content-type': 'text/plain' });
    const res = new Response('x', { headers });
    expect(await __readBoundedTextForTests(res, headers)).toBe('[body omitted: 10485760 bytes]');
  });
});

describe('net lane across a change of leader', () => {
  it('a response that arrives after another recorder took the lead is not captured, and its clone is cancelled', async () => {
    const { unpatchNetwork } = await import('../capture/net');
    const { leadState } = await import('../state');
    unpatchNetwork();
    let cancelled = 0;
    let answer: (r: Response) => void = () => undefined;
    const slow = (() =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      })) as unknown as typeof fetch;
    globalThis.fetch = slow;
    patchNetwork();
    setState(liveSession());
    const pending = fetch('https://api.example.test/slow');
    // The extension took the lead while the request was out.
    leadState.following = 'extension';
    try {
      const res = new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
      const body = { cancel: async () => void (cancelled += 1) };
      Object.defineProperty(res, 'clone', { value: () => ({ body }) });
      answer(res);
      await pending;
      await capturesSettled();
      expect(cancelled).toBe(1);
      expect(recorded()).toHaveLength(0);
    } finally {
      leadState.following = null;
    }
  });
});
