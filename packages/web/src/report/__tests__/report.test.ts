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
import { type ReportEnvelope, ReportJob } from '../wire';

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
const realFetch = globalThis.fetch;

beforeEach(() => {
  seen = [];
  failChunk2 = 0;
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
