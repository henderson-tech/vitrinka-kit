/**
 * The report face's contracts below the UI: the wire resumes the failed leg
 * (one report, never a duplicate), a host can only narrow the capture
 * profile, and a hide marker blanks its region in the capture.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type eventWithTime, EventType } from '@rrweb/types';

import { configureRecorder, recorderConfig } from '../../recorder/config';
import { flightActive } from '../../recorder/flight';
import { claimCapture, releaseCapture } from '../../recorder/state';
import { acquireEngine, type BuiltCapture, releaseEngine } from '../engine';
import { applyHides, HIDE_ATTR } from '../markers';
import { narrowProfile, parseProfile } from '../profile';
import { openSession, sessionKey } from '../reader';
import { EMPTY_CAPTURE, prepareCapture, type ReportEnvelope, ReportJob } from '../wire';

const BASE = 'https://vitrinka.test';
const REPORT_URL = 'https://portal.vitrinka.test/acme/voke/reports/rep-1?from=widget';

interface Seen {
  method: string;
  path: string;
  auth: string;
  body: unknown;
}

let seen: Seen[] = [];
let failChunk2 = 0;
/** A test's own answer for a call, ahead of the stub's. */
let answer: (method: string, path: string, body: unknown) => Response | undefined = () => undefined;
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  failChunk2 = 0;
  answer = () => undefined;
  configureRecorder({ url: BASE, key: 'vkb_test' });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.slice(BASE.length);
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    try {
      body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    } catch {
      // a raw chunk that is not JSON
    }
    seen.push({ method, path, auth: new Headers(init.headers).get('authorization') ?? '', body });
    const own = answer(method, path, body);
    if (own) return own;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (method === 'POST' && path === '/api/v1/reports') return json({ id: 'rep-1', custody: 'quarantined' }, 201);
    const chunk = /\/chunk\?seq=(\d+)$/.exec(path);
    if (chunk) {
      if (chunk[1] === '2' && failChunk2-- > 0) return new Response('storage unavailable', { status: 503 });
      return json({ blobKey: `reports/rep-1/chunk-${chunk[1]}` }, 201);
    }
    if (path.endsWith('/events')) return json({ inserted: 2 });
    if (path.endsWith('/submit')) return json({ status: 'filed', reportUrl: REPORT_URL });
    if (path === '/api/v1/report-config') return json({ project: 'voke', captureProfile: { storage: 'memory', classes: ['errors'] }, profile: 'strict' });
    if (method === 'PATCH') return json({ ok: true });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const capture: BuiltCapture = {
  chunks: [
    { seq: 1, ts: '2026-10-16T10:00:01.000Z', count: 2, body: '[{"type":4},{"type":2}]' },
    { seq: 2, ts: '2026-10-16T10:00:02.000Z', count: 1, body: '[{"type":3}]' },
  ],
  truncated: false,
  console: [{ level: 'error', ts: '2026-10-16T10:00:00.500Z', text: 'TypeError: total is NaN' }],
  network: [{ method: 'POST', path: '/api/settlement', status: 500, ms: 120 }],
};

function envelope(description: string): ReportEnvelope {
  return {
    title: description,
    description,
    env: { url: 'https://app.example.test/settlement', ua: 'test', viewport: { w: 1280, h: 800, dpr: 2 }, appVersion: '1.2.3', locale: 'cs-CZ' },
    console: capture.console,
    network: capture.network,
    identity: { email: 'jana@example.test', name: 'Jana' },
    markers: [{ n: 1, shape: 'circle', rect: { x: 10, y: 20, w: 300, h: 40 }, note: 'here twice' }],
    locale: 'cs',
    notify: true,
  };
}

describe('the report wire', () => {
  it('resumes the failed leg on retry — one report, never a duplicate', async () => {
    failChunk2 = 1;
    const job = new ReportJob(capture, 'app.example.test', { url: BASE, key: 'vkb_test' });
    await expect(job.run(envelope('August is listed twice'))).rejects.toThrow('503');
    const reply = await job.run(envelope('August is listed twice in my settlement'));

    expect(reply).toEqual({ status: 'filed', reportUrl: REPORT_URL });
    expect(seen.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/v1/reports',
      'POST /api/v1/reports/rep-1/chunk?seq=1',
      'POST /api/v1/reports/rep-1/chunk?seq=2',
      'PATCH /api/v1/reports/rep-1',
      'POST /api/v1/reports/rep-1/chunk?seq=2',
      'POST /api/v1/reports/rep-1/events',
      'POST /api/v1/reports/rep-1/submit',
    ]);
    expect(seen.every((c) => c.auth === 'Bearer vkb_test')).toBe(true);
    expect(seen[0]!.body).toMatchObject({
      description: 'August is listed twice',
      env: { viewport: { w: 1280, h: 800, dpr: 2 } },
      identity: { email: 'jana@example.test', name: 'Jana' },
      markers: [{ n: 1, shape: 'circle', rect: { x: 10, y: 20, w: 300, h: 40 }, note: 'here twice' }],
      locale: 'cs',
      notify: true,
    });
    expect(seen[3]!.body).toMatchObject({ description: 'August is listed twice in my settlement' });
    expect((seen[5]!.body as { events: unknown[] }).events).toEqual([
      { seq: 1, ts: capture.chunks[0]!.ts, tabHost: 'app.example.test', kind: 'rrweb', payload: { count: 2, source: 'replay', truncated: false }, blobKey: 'reports/rep-1/chunk-1' },
      { seq: 2, ts: capture.chunks[1]!.ts, tabHost: 'app.example.test', kind: 'rrweb', payload: { count: 1, source: 'replay', truncated: false }, blobKey: 'reports/rep-1/chunk-2' },
    ]);
  });
});

/** An older vitrinka's strict decoder refusing `name`: its error lists the fields it takes, `type` among them. */
const unknownField = (name: string): Response =>
  new Response(
    JSON.stringify({ error: `invalid JSON body: json: unknown field "${name}"; accepted top-level fields: title, description, env, console, network, identity, markers, locale, notify, type` }),
    { status: 400 },
  );
const carriesLink = (body: unknown): boolean => typeof body === 'object' && body !== null && 'memberToken' in body;

describe('a member link on the report wire (vt-8020)', () => {
  it('a vitrinka that takes no member link yet gets the report again without it, once, keeping the reporter’s word', async () => {
    answer = (method, path, body) => (method === 'POST' && path === '/api/v1/reports' && carriesLink(body) ? unknownField('memberToken') : undefined);
    const job = new ReportJob(EMPTY_CAPTURE, 'app.example.test', { url: BASE, key: 'vkb_test' });
    expect(await job.run({ ...envelope('August is listed twice'), type: 'bug', memberToken: 'vkr_member' })).toEqual({ status: 'filed', reportUrl: REPORT_URL });
    const creates = seen.filter((c) => c.path === '/api/v1/reports');
    expect(creates.map((c) => carriesLink(c.body))).toEqual([true, false]);
    expect(creates[1]!.body).toMatchObject({ type: 'bug', description: 'August is listed twice' });
    expect(job.memberSent).toBe('');
  });

  it('a link the server did not take comes back on the reply, and the report files', async () => {
    answer = (method, path) =>
      method === 'POST' && path === '/api/v1/reports' ? new Response(JSON.stringify({ id: 'rep-1', custody: 'direct', memberError: 'revoked' }), { status: 201 }) : undefined;
    const job = new ReportJob(EMPTY_CAPTURE, 'app.example.test', { url: BASE, key: 'vkb_test' });
    expect(await job.run({ ...envelope('August is listed twice'), memberToken: 'vkr_member' })).toEqual({ status: 'filed', reportUrl: REPORT_URL, memberError: 'revoked' });
    expect(job.memberSent).toBe('vkr_member');
    expect(seen.every((c) => c.auth === 'Bearer vkb_test')).toBe(true);
  });

  it('the reporter session proves the link beside the token; a vitrinka that takes none yet opens it without', async () => {
    answer = (_method, path, body) => {
      if (path !== '/api/v1/report/session') return undefined;
      if (carriesLink(body)) return unknownField('memberToken');
      return new Response(JSON.stringify({ reporter: { id: 'r-ann', email: 'ann@example.test' }, session: 'rs_ann', expiresAt: '2026-10-19T12:00:00Z' }));
    };
    expect((await openSession({ url: BASE, key: 'vkb_test' }, 'host.jws', 'vkr_member')).session).toBe('rs_ann');
    expect(seen.map((c) => c.body)).toEqual([{ token: 'host.jws', memberToken: 'vkr_member' }, { token: 'host.jws' }]);
  });

  it('a session belongs to the host token and the link it proved; there is none without a host token', () => {
    expect(sessionKey('host.jws', 'vkr_member')).not.toBe(sessionKey('host.jws', ''));
    expect(sessionKey('host.jws', 'vkr_member')).not.toBe(sessionKey('host.jws', 'vkr_relinked'));
    expect(sessionKey('', 'vkr_member')).toBe('');
  });
});

describe('the capture under its deadline', () => {
  it('a capture still preparing at its deadline is dropped: the report files with its words, and the late build changes nothing', async () => {
    let finish: (c: BuiltCapture) => void = () => undefined;
    const late = new Promise<BuiltCapture>((resolve) => {
      finish = resolve;
    });
    const prepared = await prepareCapture(() => late, 20);
    expect(prepared).toEqual(EMPTY_CAPTURE);
    const job = new ReportJob(prepared, 'app.example.test', { url: BASE, key: 'vkb_test' });
    expect(await job.run(envelope('August is listed twice'))).toEqual({ status: 'filed', reportUrl: REPORT_URL });
    finish(capture);
    await late;
    expect(job.capture).toEqual(EMPTY_CAPTURE);
    expect(seen.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/v1/reports', 'POST /api/v1/reports/rep-1/submit']);
    expect(seen[0]!.body).toMatchObject({ description: 'August is listed twice', markers: [{ n: 1, note: 'here twice' }], identity: { email: 'jana@example.test' } });
  });
});

describe('the report wire, two widgets on one page', () => {
  it('sends to its own base with its own key, whatever another widget configured', async () => {
    configureRecorder({ url: 'https://another-vitrinka.test', key: 'vkb_other' });
    const job = new ReportJob(capture, 'app.example.test', { url: BASE, key: 'vkb_test' });
    const reply = await job.run(envelope('Wrong project?'));
    expect(reply.status).toBe('filed');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c.auth === 'Bearer vkb_test' && c.path.startsWith('/api/v1/reports'))).toBe(true);
  });
});

describe('one capture runtime per page', () => {
  const engineOpts = { base: BASE, key: 'vkb_test', loadRecord: async () => null };

  it('a report face beside a mounted recorder leaves the recorder its target and its buffer', async () => {
    configureRecorder({ url: 'https://recorder.vitrinka.test', key: 'vkr_rec' });
    const recorder = claimCapture('recorder');
    const engine = acquireEngine(engineOpts)!;
    const config = await engine.ready;
    expect(recorderConfig()).toMatchObject({ url: 'https://recorder.vitrinka.test', key: 'vkr_rec' });
    expect(config.capturing).toBe(false);
    expect(flightActive()).toBe(false);
    releaseEngine(engine);
    releaseCapture(recorder);
  });

  it('a recorder that mounts after a report face takes the runtime over, and the widget hears it', async () => {
    const engine = acquireEngine(engineOpts)!;
    const config = await engine.ready;
    expect(config.capturing).toBe(true);
    expect(flightActive()).toBe(true);
    let heard = 0;
    engine.onChange(() => heard++);
    const recorder = claimCapture('recorder');
    expect(flightActive()).toBe(false);
    expect(config.capturing).toBe(false);
    expect(heard).toBe(1);
    releaseCapture(recorder);
    releaseEngine(engine);
  });
});

describe('a shared engine', () => {
  const engineOpts = { base: BASE, key: 'vkb_test', loadRecord: async () => null };

  it('captures nothing for a widget whose narrowing or sanitizer differs from the one that started it', async () => {
    const first = acquireEngine(engineOpts)!;
    expect(acquireEngine({ ...engineOpts, capture: { storage: 'memory', classes: ['errors'] } })).toBeNull();
    expect(acquireEngine({ ...engineOpts, sanitizeUrl: (u: string) => u })).toBeNull();
    const same = acquireEngine({ ...engineOpts });
    expect(same).toBe(first);
    releaseEngine(same);
    releaseEngine(first);
  });

  it('drops a whole window whose snapshot is over the wire cap, never just the snapshot', async () => {
    const engine = acquireEngine(engineOpts)!;
    await engine.ready;
    const ev = (type: number, t: number, payload = ''): eventWithTime => ({ type, timestamp: t, data: { payload } }) as unknown as eventWithTime;
    const win = (id: string, events: eventWithTime[]) => ({ id, load: 'l', startMs: events[0]!.timestamp, lastMs: events.at(-1)!.timestamp, events, count: events.length, bytes: 0, href: '', route: '/' });
    const huge = 'x'.repeat(5 * 1024 * 1024);
    const built = await engine.build(
      {
        clip: { windows: [win('a', [ev(4, 1), ev(2, 2, huge), ev(3, 3, 'after-huge')]), win('b', [ev(4, 10), ev(2, 11), ev(3, 12, 'kept')])], lanes: [], truncated: false },
        stored: Promise.resolve(new Map()),
      },
      [],
    );
    const body = built.chunks.map((c) => c.body).join('');
    expect(body).not.toContain('after-huge');
    expect(body).toContain('kept');
    expect(built.chunks.reduce((n, c) => n + c.count, 0)).toBe(3);
    expect(built.truncated).toBe(true);
    releaseEngine(engine);
  });
});

describe('the capture profile', () => {
  it('a host can only narrow the project profile', () => {
    const project = parseProfile({ storage: 'browser', windowSec: 300, maxBytes: 12 * 1024 * 1024, classes: ['interactions', 'console', 'network', 'errors'] });
    expect(narrowProfile(project, { storage: 'memory', windowSec: 120, classes: ['errors', 'interactions'] })).toEqual({
      storage: 'memory',
      windowSec: 120,
      maxBytes: 12 * 1024 * 1024,
      classes: ['errors', 'interactions'],
    });
    const lean = parseProfile({ storage: 'memory', windowSec: 60, maxBytes: 1024 * 1024, classes: ['errors'] });
    expect(narrowProfile(lean, { storage: 'browser', windowSec: 900, maxBytes: 64 * 1024 * 1024, classes: ['full'] })).toEqual(lean);
  });
});

describe('hide markers', () => {
  it('blank their region in every full snapshot and empty the hidden nodes everywhere', () => {
    const snapshot = {
      type: EventType.FullSnapshot,
      timestamp: 1,
      data: {
        initialOffset: { top: 0, left: 0 },
        node: {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              id: 2,
              tagName: 'html',
              attributes: {},
              childNodes: [
                {
                  type: 2,
                  id: 3,
                  tagName: 'body',
                  attributes: {},
                  childNodes: [
                    { type: 3, id: 4, textContent: 'IBAN CZ65 0800 0000 1920 0014 5399' },
                    { type: 3, id: 5, textContent: 'visible' },
                  ],
                },
              ],
            },
          ],
        },
      },
    } as unknown as eventWithTime;
    const mutation = {
      type: EventType.IncrementalSnapshot,
      timestamp: 2,
      data: { source: 0, texts: [{ id: 4, value: 'IBAN CZ65 0800 0000 1920 0014 5400' }], attributes: [], removes: [], adds: [] },
    } as unknown as eventWithTime;

    const [snap, mut] = applyHides([snapshot, mutation], [{ x: 10, y: 20, w: 300, h: 40 }], new Set([4]));
    const raw = JSON.stringify([snap, mut]);
    expect(raw).not.toContain('IBAN');
    expect(raw).toContain('visible');
    expect(raw).toContain(HIDE_ATTR);
    expect(raw).toContain('left:10px;top:20px;width:300px;height:40px');
    // The buffer's own copy is untouched.
    expect(JSON.stringify(snapshot)).toContain('IBAN');
  });
});
