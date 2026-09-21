/**
 * Test transport: a scripted `globalThis.fetch` that records every call to
 * the session doors and answers like the vitrinka server. Driving the REAL
 * api client this way (rather than mocking `../api`) keeps the headers,
 * `credentials: omit` and the chunk route under test too.
 */
import { configureRecorder } from '../config';
import { __resetForTests } from '../queue';
import { __resetNavForTests } from '../capture/nav';
import { setRedactionPolicy } from '../capture/redact';
import { __resetStorageForTests, configureRecorderStorage, memoryRecorderStorage } from '../storage';

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

export type Outcome = { ok: true; body?: unknown } | { ok: false; status: number };

export interface Stub {
  calls: Call[];
  /** Scripted outcomes per route family; consumed in order, then ok. */
  script: { events: Outcome[]; chunks: Outcome[]; sessions: Outcome[]; patch: Outcome[] };
  /** When set, events POSTs park here until released. */
  gate: Promise<void> | null;
  restore: () => void;
}

export const BASE = 'https://vitrinka.test';

export function installStub(): Stub {
  const orig = globalThis.fetch;
  const stub: Stub = {
    calls: [],
    script: { events: [], chunks: [], sessions: [], patch: [] },
    gate: null,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
  const answer = (o: Outcome | undefined, fallback: unknown): Response => {
    if (o && !o.ok) return new Response(`err ${o.status}`, { status: o.status });
    return new Response(JSON.stringify(o?.body ?? fallback), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = init.body;
    if (typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    stub.calls.push({ method: init.method ?? 'GET', path, headers, body, init });
    if (path === '/api/v1/recorder/policy') return answer(undefined, { policy: null });
    if (path === '/api/v1/sessions' && init.method === 'POST') {
      const b = body as { title?: string; environment?: string };
      return answer(stub.script.sessions.shift(), {
        id: 'sess-1',
        project: 'example',
        environment: b.environment || 'development',
        title: b.title ?? '',
        workspace: 'acme',
        boardSlug: 'example-session-1',
        boardUrl: 'https://vitrinka.test/acme/b/example-session-1?x=1',
      });
    }
    if (path.endsWith('/events')) {
      if (stub.gate) await stub.gate;
      return answer(stub.script.events.shift(), {});
    }
    if (path.includes('/chunk?seq=')) {
      const seq = path.split('seq=')[1];
      return answer(stub.script.chunks.shift(), { blobKey: `blob-${seq}` });
    }
    if (path.endsWith('/tags')) return answer(undefined, {});
    if (init.method === 'PATCH') {
      return answer(stub.script.patch.shift(), {
        boardSlug: 'example-session-1',
        board: { url: 'https://vitrinka.test/acme/b/example-session-1?x=1' },
      });
    }
    if (init.method === 'GET') return answer(stub.script.sessions.shift(), { maxSeq: 0, status: 'recording' });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return stub;
}

/** Fresh recorder: memory storage, configured target, empty queue. */
export function freshRecorder(): void {
  __resetStorageForTests();
  configureRecorderStorage(memoryRecorderStorage());
  configureRecorder({ url: `${BASE}/`, key: 'vkr_test' });
  __resetForTests();
  __resetNavForTests();
  setRedactionPolicy(null);
}

/** A live session record written straight into state (no create round-trip). */
export function liveSession(paused = false) {
  return {
    sessionId: 'sess-1',
    project: 'example',
    environment: 'development',
    title: '',
    seq: 0,
    paused,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
  };
}

export const ROUTE = { tabId: 'tab-1', tabHost: 'app.example.test' };

/** Install a browser-ish `location`/`navigator` for modules that read them. */
export function fakeLocation(href = 'https://app.example.test/orders/42'): void {
  const u = new URL(href);
  Object.defineProperty(globalThis, 'location', {
    value: { href: u.href, host: u.host, pathname: u.pathname },
    configurable: true,
    writable: true,
  });
}
