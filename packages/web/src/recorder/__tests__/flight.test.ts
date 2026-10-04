/**
 * The idle pill's flight recorder and "Report a bug" (react-recorder D9–D11):
 * the rolling two-window buffer and its caps, the privacy posture while idle,
 * the opt-out, and what a report files — idle as its own short session,
 * recording as a task annotation in the live one.
 */
import { afterEach, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';
import { type eventWithTime, EventType } from '@rrweb/types';

import { startFlightRRWeb, stopRRWeb } from '../capture/rrweb';
import { configureRecorder } from '../config';
import { flightActive, pushFlightRRWeb, startFlightBuffer, takeFlightClip } from '../flight';
import { __bufferForTests, pushEvent, setState } from '../queue';
import { canReport, holdReport, sendReport, syncFlight, wantFlight } from '../report';
import { currentRoute, setTabIdentity } from '../state';
import { __resetStorageForTests, configureRecorderStorage, memoryRecorderStorage } from '../storage';
import { BASE, fakeLocation, freshRecorder, installStub, liveSession, ROUTE, type Stub } from './stub';

let stub: Stub;
const T0 = Date.parse('2026-10-05T10:00:00.000Z');
const HREF = 'https://app.example.test/orders/42?token=[redacted]';

const meta = (t: number): eventWithTime => ({ type: EventType.Meta, data: { href: HREF, width: 1280, height: 800 }, timestamp: t });
const full = (t: number): eventWithTime => ({
  type: EventType.FullSnapshot,
  data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
  timestamp: t,
});
const custom = (t: number, payload = ''): eventWithTime => ({ type: EventType.Custom, data: { tag: 'step', payload }, timestamp: t });

// rrweb without a DOM: `record` keeps the lane's emit and emits nothing on its
// own; a checkout (`takeFullSnapshot`) emits Meta + FullSnapshot through it
// synchronously, as rrweb does.
let rrwebEmit: ((ev: eventWithTime) => void) | null = null;
let checkouts = 0;
const fakeRecord = Object.assign(
  (opts: { emit?: (ev: eventWithTime) => void }) => {
    rrwebEmit = opts.emit ?? null;
    return () => {
      rrwebEmit = null;
    };
  },
  {
    takeFullSnapshot: () => {
      checkouts++;
      rrwebEmit?.(meta(Date.now()));
      rrwebEmit?.(full(Date.now()));
    },
  },
);
mock.module('rrweb', () => ({ record: fakeRecord }));

beforeEach(() => {
  stub = installStub();
  freshRecorder();
  fakeLocation('https://app.example.test/orders/42');
  setTabIdentity('tab-1', 'app.example.test');
  currentRoute.pathname = '/orders/42';
});
afterEach(() => {
  stopRRWeb();
  setSystemTime();
  stub.restore();
});

describe('flight recorder', () => {
  it('keeps two checkout windows, opens the clip on a full snapshot and drops older lane events', () => {
    setSystemTime(new Date(T0));
    startFlightBuffer();
    pushFlightRRWeb(custom(T0 - 5)); // before any snapshot: nothing to replay it on
    pushFlightRRWeb(meta(T0));
    pushFlightRRWeb(full(T0 + 1));
    pushEvent('click', { selector: '#old' }, ROUTE);
    setSystemTime(new Date(T0 + 30_001));
    pushFlightRRWeb(meta(T0 + 30_001));
    pushFlightRRWeb(full(T0 + 30_002));
    pushEvent('click', { selector: '#kept' }, ROUTE);
    pushFlightRRWeb(meta(T0 + 60_002));
    pushFlightRRWeb(full(T0 + 60_003));
    pushFlightRRWeb(custom(T0 + 60_004));

    const clip = takeFlightClip()!;
    expect(clip.windows).toHaveLength(2);
    expect(clip.windows[0]!.events.slice(0, 2).map((e) => [e.type, e.timestamp])).toEqual([
      [EventType.Meta, T0 + 30_001],
      [EventType.FullSnapshot, T0 + 30_002],
    ]);
    expect(clip.windows[1]!.events.map((e) => e.type)).toEqual([EventType.Meta, EventType.FullSnapshot, EventType.Custom]);
    expect(clip.windows[0]!.href).toBe(HREF);
    expect(clip.lanes.map((e) => e.payload?.selector)).toEqual(['#kept']);
  });

  it('drops the older window over the byte or event cap, and keeps the newest 500 lane events', () => {
    startFlightBuffer();
    pushFlightRRWeb(meta(T0));
    pushFlightRRWeb(full(T0 + 1));
    pushFlightRRWeb(custom(T0 + 2, 'x'.repeat(3 * 1024 * 1024)));
    pushFlightRRWeb(meta(T0 + 30_001));
    pushFlightRRWeb(full(T0 + 30_002));
    expect(takeFlightClip()!.windows).toHaveLength(2);
    pushFlightRRWeb(custom(T0 + 30_003, 'y'.repeat(1024 * 1024 + 1)));
    let windows = takeFlightClip()!.windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]!.events[0]!.timestamp).toBe(T0 + 30_001);

    // Two windows over 20 000 events: the older goes, the newer alone fits.
    pushFlightRRWeb(meta(T0 + 60_002));
    for (let i = 0; i < 19_998; i++) pushFlightRRWeb(custom(T0 + 60_003 + i));
    windows = takeFlightClip()!.windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]!.events[0]!.timestamp).toBe(T0 + 60_002);

    setSystemTime(new Date(T0 + 90_000));
    for (let i = 0; i < 501; i++) pushEvent('console', { level: 'error', text: `e${i}` }, ROUTE);
    const lanes = takeFlightClip()!.lanes;
    expect(lanes).toHaveLength(500);
    expect(lanes[0]!.payload?.text).toBe('e1');
  });

  it('buffers while idle without writing storage or calling the server beyond the policy', async () => {
    let writes = 0;
    const mem = memoryRecorderStorage();
    __resetStorageForTests();
    configureRecorderStorage({
      getString: mem.getString,
      set: (k, v) => {
        writes++;
        mem.set(k, v);
      },
      remove: (k) => {
        writes++;
        mem.remove(k);
      },
    });
    wantFlight();
    await syncFlight();
    expect(flightActive()).toBe(true);
    expect(stub.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/v1/recorder/policy']);

    pushFlightRRWeb(meta(Date.now()));
    pushFlightRRWeb(full(Date.now()));
    pushEvent('click', { selector: '#buy', text: 'Buy' }, ROUTE);
    pushEvent('nav', { url: 'https://app.example.test/cart', route: '/cart', spa: true }, ROUTE);
    pushEvent('console', { level: 'error', text: 'boom' }, ROUTE);
    holdReport(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(takeFlightClip()!.lanes.map((e) => e.kind)).toEqual(['click', 'nav', 'console']);
    expect(writes).toBe(0);
    expect(stub.calls).toHaveLength(1);
    expect(canReport()).toBe(true);
  });

  it('flightRecorder: false keeps nothing and offers no idle report', async () => {
    configureRecorder({ url: BASE, key: 'vkr_test', flightRecorder: false });
    wantFlight();
    await syncFlight();
    expect(pushEvent('click', { selector: '#buy' }, ROUTE)).toBeNull();
    expect(flightActive()).toBe(false);
    expect(takeFlightClip()).toBeNull();
    expect(canReport()).toBe(false);
    expect(stub.calls).toEqual([]);
  });
});

describe('report', () => {
  it('files create → lane events with their original ts → rrweb chunk → task annotation → done', async () => {
    setSystemTime(new Date(T0));
    wantFlight();
    await syncFlight();
    pushFlightRRWeb(meta(T0));
    pushFlightRRWeb(full(T0 + 1));
    setSystemTime(new Date(T0 + 100));
    pushEvent('click', { selector: '#apply', text: 'Apply' }, ROUTE);
    pushFlightRRWeb(custom(T0 + 101));
    setSystemTime(new Date(T0 + 5_000));
    holdReport(true);
    // Typing the description: the buffer rolls on, the frozen clip does not.
    pushEvent('click', { selector: '#later' }, ROUTE);
    setSystemTime(new Date(T0 + 9_000));
    stub.calls.length = 0;

    const out = await sendReport({ text: 'Total shows NaN\nafter the coupon', rect: { x: 10, y: 20, w: 30, h: 40 }, selector: '' });

    expect(stub.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/v1/sessions',
      'POST /api/v1/sessions/sess-1/events',
      'POST /api/v1/sessions/sess-1/chunk?seq=3',
      'POST /api/v1/sessions/sess-1/events',
      'POST /api/v1/sessions/sess-1/events',
      'PATCH /api/v1/sessions/sess-1',
    ]);
    const [create, lanes, chunk, rows, note, done] = stub.calls;
    expect(create!.body).toMatchObject({
      host: 'app.example.test',
      title: 'Bug report: Total shows NaN',
      meta: { kind: 'report', platform: 'web', devicePixelRatio: 1 },
    });
    expect((lanes!.body as { events: unknown[] }).events).toEqual([
      { seq: 1, ts: new Date(T0).toISOString(), tabId: 'tab-1', tabHost: 'app.example.test', kind: 'nav', payload: { url: HREF, route: '/orders/42' } },
      { seq: 2, ts: new Date(T0 + 100).toISOString(), ...ROUTE, kind: 'click', payload: { selector: '#apply', text: 'Apply' } },
    ]);
    expect((chunk!.body as eventWithTime[]).map((e) => e.timestamp)).toEqual([T0, T0 + 1, T0 + 101]);
    expect((rows!.body as { events: unknown[] }).events).toEqual([
      { seq: 3, ts: new Date(T0 + 101).toISOString(), tabId: 'tab-1', tabHost: 'app.example.test', kind: 'rrweb', payload: { count: 3 }, blobKey: 'blob-3' },
    ]);
    expect((note!.body as { events: unknown[] }).events).toEqual([
      {
        seq: 4,
        ts: new Date(T0 + 9_000).toISOString(),
        tabId: 'tab-1',
        tabHost: 'app.example.test',
        kind: 'note',
        payload: { text: 'Total shows NaN\nafter the coupon', rect: { x: 10, y: 20, w: 30, h: 40 }, selector: '', annotate: true, task: true, route: '/orders/42' },
      },
    ]);
    expect(done!.body).toEqual({ status: 'done' });
    expect(out.boardUrl).toBe('https://vitrinka.test/acme/b/example-session-1?x=1');
  });

  it('a report frozen over an empty buffer takes one checkout and opens on a full snapshot; with a window held it takes none', async () => {
    setSystemTime(new Date(T0));
    wantFlight();
    await syncFlight();
    startFlightRRWeb();
    checkouts = 0;
    // The lone window went over a cap, or the first snapshot never came.
    expect(takeFlightClip()!.windows).toEqual([]);

    holdReport(true);
    expect(checkouts).toBe(1);
    stub.calls.length = 0;
    await sendReport({ text: 'The board stays empty', rect: null, selector: '' });
    const chunk = stub.calls.find((c) => c.path.includes('/chunk?seq='));
    expect((chunk!.body as eventWithTime[]).map((e) => e.type)).toEqual([EventType.Meta, EventType.FullSnapshot]);

    holdReport(true);
    expect(checkouts).toBe(1);
  });

  it('while recording, files a task annotation into the live session and creates nothing', async () => {
    setState(liveSession());
    const out = await sendReport({ text: 'Button overlaps', rect: { x: 1, y: 2, w: 3, h: 4 }, selector: '#buy' });
    expect(__bufferForTests().at(-1)).toMatchObject({
      kind: 'note',
      payload: { text: 'Button overlaps', rect: { x: 1, y: 2, w: 3, h: 4 }, selector: '#buy', annotate: true, task: true },
    });
    expect(stub.calls.some((c) => c.path === '/api/v1/sessions')).toBe(false);
    expect(out).toEqual({});
  });
});
