/**
 * The capture profile's browser storage (QA Studio D7, S3): the 5-minute
 * profile keeps masked chunks in IndexedDB, loses them with the window and
 * on the next load past their age, clears them after a report is sent; and
 * a buffer over its size cap forces a fresh checkout and says `truncated`.
 * Driven through the real rrweb lane with a DOM-less rrweb stand-in, over
 * fake-indexeddb.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { type eventWithTime, EventType } from '@rrweb/types';
import { IDBFactory } from 'fake-indexeddb';

import { setRedactionPolicy } from '../../recorder/capture/redact';
import { type RecordFn, startRecordWith, stopRRWeb } from '../../recorder/capture/rrweb-lane';
import { configureRecorder } from '../../recorder/config';
import {
  clearFlight,
  type FlightProfile,
  type FlightStore,
  flightWrites,
  persistFlightNow,
  pushFlightEvent,
  startFlightBuffer,
  stopFlightBuffer,
  takeFlightClip,
} from '../../recorder/flight';
import { setTabIdentity } from '../../recorder/state';
import { type CaptureStore, openCaptureStore } from '../../recorder/storage/capture';
import { fakeLocation } from '../../recorder/__tests__/stub';
import { acquireEngine, releaseEngine } from '../engine';
import { maskingPolicy } from '../profile';

const T0 = Date.parse('2026-10-16T10:00:00.000Z');
const FIVE_MIN = 5 * 60_000;
const TAB = 'tab-1';

const meta = (t: number): eventWithTime => ({
  type: EventType.Meta,
  data: { href: 'https://app.example.test/orders/42?token=s3cr3t-value', width: 1280, height: 800 },
  timestamp: t,
});
const full = (t: number): eventWithTime => ({
  type: EventType.FullSnapshot,
  data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
  timestamp: t,
});
const custom = (t: number, payload = ''): eventWithTime => ({ type: EventType.Custom, data: { tag: 'step', payload }, timestamp: t });

// rrweb without a DOM: `record` keeps the lane's emit and options; a checkout
// emits Meta + FullSnapshot through it synchronously, as rrweb does.
let emit: ((ev: eventWithTime) => void) | null = null;
let recordOptions: Record<string, unknown> = {};
let checkouts = 0;
const fakeRecord = Object.assign(
  (opts: Record<string, unknown> & { emit?: (ev: eventWithTime) => void }) => {
    emit = opts.emit ?? null;
    recordOptions = opts;
    return () => {
      emit = null;
    };
  },
  {
    takeFullSnapshot: () => {
      checkouts++;
      emit?.(meta(Date.now()));
      emit?.(full(Date.now()));
    },
  },
) as unknown as RecordFn;

function profile(store: FlightStore | null, over: Partial<FlightProfile> = {}): FlightProfile {
  return { windowMs: FIVE_MIN, checkoutMs: 60_000, maxBytes: 12 * 1024 * 1024, maxEvents: 60_000, maxLaneEvents: 500, store, ...over };
}

async function storedWindows(store: CaptureStore, now: number): Promise<string[]> {
  return (await store.sweep(now, FIVE_MIN, TAB, '')).map((w) => w.id);
}

let store: CaptureStore | null = null;

beforeEach(() => {
  fakeLocation('https://app.example.test/orders/42?token=s3cr3t-value');
  setTabIdentity(TAB, 'app.example.test');
  configureRecorder({ url: 'https://vitrinka.test', key: 'vkb_test' });
  setRedactionPolicy(maskingPolicy('strict'));
  checkouts = 0;
});
afterEach(() => {
  stopRRWeb();
  stopFlightBuffer();
  store?.close();
  store = null;
  setSystemTime();
});

describe('the capture profile in browser storage', () => {
  it('stores masked chunks in IndexedDB and expires them with the window, then on the next load past their age', async () => {
    const idb = new IDBFactory();
    store = await openCaptureStore(idb);
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(store));
    startRecordWith(fakeRecord, 'flight');
    // rrweb masks the DOM at emit under the strict profile; the lane scrubs the page URL.
    expect(recordOptions).toMatchObject({ maskAllInputs: true, maskTextSelector: '*', checkoutEveryNms: 60_000 });
    emit?.(meta(T0));
    emit?.(full(T0 + 1));
    emit?.(custom(T0 + 2, 'clicked'));
    persistFlightNow();
    await flightWrites();

    const [first] = await storedWindows(store, T0 + 10);
    expect(first).toBeDefined();
    const stored = await store.read(first!);
    expect(stored.events.map((e) => e.type)).toEqual([EventType.Meta, EventType.FullSnapshot, EventType.Custom]);
    const raw = JSON.stringify(stored.events);
    expect(raw).not.toContain('s3cr3t-value');
    expect(raw).toContain('[redacted]');

    // A checkout a minute later opens the second window; once IT is older
    // than five minutes, the first covers nothing of the window and goes.
    setSystemTime(new Date(T0 + 61_000));
    fakeRecord.takeFullSnapshot(true);
    setSystemTime(new Date(T0 + 362_000));
    emit?.(custom(T0 + 362_000));
    persistFlightNow();
    await flightWrites();
    const left = await storedWindows(store, T0 + 362_000);
    expect(left).toHaveLength(1);
    expect(left).not.toContain(first);
    expect((await store.read(first!)).events).toEqual([]);

    // The next load within the window gets the survivor back; one past its age finds nothing.
    stopRRWeb();
    stopFlightBuffer();
    store.close();
    store = await openCaptureStore(idb);
    expect(await storedWindows(store, T0 + 400_000)).toEqual(left);
    expect(await storedWindows(store, T0 + 362_000 + FIVE_MIN + 1)).toEqual([]);
  });

  it('clears the stored chunks after a report is sent', async () => {
    store = await openCaptureStore(new IDBFactory());
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(store));
    startRecordWith(fakeRecord, 'flight');
    emit?.(meta(T0));
    emit?.(full(T0 + 1));
    persistFlightNow();
    await flightWrites();
    const sent = await storedWindows(store, T0 + 10);
    expect(sent).toHaveLength(1);

    clearFlight();
    await flightWrites();
    expect((await store.read(sent[0]!)).events).toEqual([]);
    // The buffer carries on from a fresh checkout: only that window is stored now.
    persistFlightNow();
    await flightWrites();
    const after = await storedWindows(store, T0 + 10);
    expect(after).toHaveLength(1);
    expect(after).not.toContain(sent[0]);
    expect(checkouts).toBe(1);
    expect(takeFlightClip()!.windows.map((w) => w.id)).toEqual(after);
  });

  it('restores only windows captured for the same project under the same privacy profile', async () => {
    const strict = 'https://vitrinka.test|voke|strict|errors,interactions';
    store = await openCaptureStore(new IDBFactory());
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(store, { scope: strict }));
    startRecordWith(fakeRecord, 'flight');
    emit?.(meta(T0));
    emit?.(full(T0 + 1));
    persistFlightNow();
    await flightWrites();
    expect(await store.sweep(T0 + 10, FIVE_MIN, TAB, strict)).toHaveLength(1);
    // Another project in this tab, or the same one now unmasked: nothing comes back, and it is gone.
    expect(await store.sweep(T0 + 10, FIVE_MIN, TAB, 'https://vitrinka.test|voke|full|errors,interactions')).toEqual([]);
    expect(await store.sweep(T0 + 10, FIVE_MIN, TAB, strict)).toEqual([]);
  });

  it('an idle page never keeps more than the window: a stale screen gives way to a fresh one', () => {
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(null));
    startRecordWith(fakeRecord, 'flight');
    emit?.(meta(T0));
    emit?.(full(T0 + 1));
    emit?.(custom(T0 + 2, 'typed long ago'));
    // Nothing moves on the page (rrweb checks out only on its own events); an error comes in.
    setSystemTime(new Date(T0 + 5 * 60_000));
    pushFlightEvent('console', { level: 'error', text: 'late error' }, { tabId: TAB, tabHost: 'app.example.test' });
    setSystemTime(new Date(T0 + 6 * 60_000));
    const clip = takeFlightClip()!;
    expect(checkouts).toBe(1);
    expect(clip.windows).toHaveLength(1);
    expect(clip.windows[0]!.startMs).toBe(T0 + 6 * 60_000);
    expect(JSON.stringify(clip.windows)).not.toContain('typed long ago');
    expect(clip.lanes.map((e) => e.payload?.text)).toEqual(['late error']);
    expect(clip.truncated).toBe(false);
  });

  it('an errors-only profile keeps its console and network entries across a reload', async () => {
    const idb = new IDBFactory();
    store = await openCaptureStore(idb);
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(store, { scope: 'errors-only' }));
    pushFlightEvent('console', { level: 'error', text: 'boom' }, { tabId: TAB, tabHost: 'app.example.test' });
    persistFlightNow();
    await flightWrites();
    stopFlightBuffer();
    store.close();

    store = await openCaptureStore(idb);
    const kept = await store.sweep(T0 + 1000, FIVE_MIN, TAB, 'errors-only');
    const lanes = (await Promise.all(kept.map((w) => store!.read(w.id)))).flatMap((r) => r.lanes);
    expect(lanes.map((e) => e.payload?.text)).toEqual(['boom']);
    startFlightBuffer(profile(store, { scope: 'errors-only', priorLanes: lanes }));
    expect(takeFlightClip()!.lanes.map((e) => e.payload?.text)).toEqual(['boom']);
  });

  it('writes a lane span’s head and its chunk in one store operation (never an orphaned chunk)', async () => {
    const ops: string[] = [];
    const fake = {
      putWindow: async (w: { id: string }) => void ops.push(`putWindow ${w.id}`),
      putChunk: async (id: string) => void ops.push(`putChunk ${id}`),
      putWindowChunk: async (w: { id: string }) => void ops.push(`putWindowChunk ${w.id}`),
      dropWindow: async () => undefined,
      clear: async () => undefined,
    };
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(fake, { scope: 's' }));
    pushFlightEvent('console', { level: 'error', text: 'boom' }, { tabId: TAB, tabHost: 'app.example.test' });
    persistFlightNow();
    await flightWrites();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatch(/^putWindowChunk .*\.lanes\.\d+$/);
    // …and the real store lands both or neither.
    store = await openCaptureStore(new IDBFactory());
    const head = { id: 'span.1', tab: TAB, scope: 's', kind: 'lanes' as const, load: 'l', startMs: T0, lastMs: T0, count: 0, bytes: 0, href: '', route: '' };
    await store.putWindowChunk(head, 0, '[]', [{ ts: new Date(T0).toISOString(), tabId: TAB, tabHost: 'h', kind: 'console', payload: { text: 'kept' } }]);
    expect((await store.sweep(T0, FIVE_MIN, TAB, 's')).map((w) => w.id)).toEqual(['span.1']);
    expect((await store.read('span.1')).lanes.map((e) => e.payload?.text)).toEqual(['kept']);
  });

  it('console and network entries restored from an earlier load leave the store once they leave the window', async () => {
    store = await openCaptureStore(new IDBFactory());
    const span = { id: 'earlier.lanes.1', tab: TAB, scope: 's', kind: 'lanes' as const, load: 'earlier', startMs: T0, lastMs: T0, count: 0, bytes: 0, href: '', route: '' };
    await store.putWindow(span);
    await store.putChunk(span.id, 0, '[]', [{ ts: new Date(T0).toISOString(), tabId: TAB, tabHost: 'app.example.test', kind: 'console', payload: { level: 'error', text: 'old' } }]);
    setSystemTime(new Date(T0 + 1000));
    startFlightBuffer(profile(store, { scope: 's', prior: [span] }));
    // The page stays open, quietly, past the window.
    setSystemTime(new Date(T0 + FIVE_MIN + 1000));
    persistFlightNow();
    await flightWrites();
    expect((await store.read(span.id)).lanes).toEqual([]);
  });

  it('a draft keeps the stored minutes it opened with, even once they age out before Send', async () => {
    const scope = 'https://vitrinka.test|voke|strict|errors,interactions';
    const seed = await openCaptureStore();
    // The engine names its tab itself: without sessionStorage (bun) that is `root`.
    await seed.putWindow({ id: 'earlier.1', tab: 'root', scope, load: 'earlier', startMs: T0, lastMs: T0 + 1000, count: 2, bytes: 100, href: 'h', route: '/' });
    await seed.putChunk('earlier.1', 0, JSON.stringify([meta(T0), full(T0 + 1)]), []);
    seed.close();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ project: 'voke', captureProfile: { storage: 'browser', windowSec: 120, classes: ['errors', 'interactions'] }, profile: 'strict' }),
      )) as unknown as typeof fetch;
    setSystemTime(new Date(T0 + 60_000));
    const engine = acquireEngine({ base: 'https://vitrinka.test', key: 'vkb_test', loadRecord: async () => fakeRecord })!;
    try {
      await engine.ready;
      emit?.(meta(T0 + 60_000));
      emit?.(full(T0 + 60_001));
      const frozen = engine.freeze();
      expect(frozen.clip!.windows.map((w) => w.id)).toContain('earlier.1');
      // The reporter takes their time: the earlier window leaves the buffer and the store.
      setSystemTime(new Date(T0 + 200_000));
      emit?.(custom(T0 + 200_000));
      persistFlightNow();
      await flightWrites();
      const built = await engine.build(frozen, []);
      expect(built.chunks.map((c) => c.body).join('')).toContain(`"timestamp":${T0}`);
    } finally {
      releaseEngine(engine);
      globalThis.fetch = realFetch;
    }
  });

  it('a size-forced checkout keeps the replay whole and marks it truncated', () => {
    setSystemTime(new Date(T0));
    startFlightBuffer(profile(null, { maxBytes: 64 * 1024 }));
    startRecordWith(fakeRecord, 'flight');
    emit?.(meta(T0));
    emit?.(full(T0 + 1));
    expect(takeFlightClip()!.truncated).toBe(false);

    setSystemTime(new Date(T0 + 5_000));
    emit?.(custom(T0 + 5_000, 'x'.repeat(80 * 1024)));
    const clip = takeFlightClip()!;
    expect(checkouts).toBe(1);
    expect(clip.truncated).toBe(true);
    expect(clip.windows).toHaveLength(1);
    // Never spliced: the clip opens on the fresh Meta + FullSnapshot.
    expect(clip.windows[0]!.events.map((e) => e.type)).toEqual([EventType.Meta, EventType.FullSnapshot]);
  });
});
