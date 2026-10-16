/**
 * The flight recorder (react-recorder decisions D9/D10, QA Studio D6/D7):
 * ONE rolling buffer for both faces of the capture client — the recorder
 * pill's idle "last minute" behind "Report a bug" (report.ts) and Report a
 * problem's capture profile (../report). A `FlightProfile` says how far back
 * it reaches, how often rrweb checks out, the caps and where windows live.
 *
 * - rrweb runs with `checkoutEveryNms: profile.checkoutMs`; every Meta event
 *   (rrweb emits one at the head of each full snapshot) opens a window, so a
 *   clip always starts at a Meta + FullSnapshot. A window is kept while it
 *   still covers part of the last `windowMs` (`windowEnd`: it lasts until the
 *   next window of its page load opens, or to its last event when the page
 *   went away). The recorder face's `RECORDER_FLIGHT` (30 s windows, 30 s
 *   checkouts) keeps the current and the previous window: the last 30–60 s.
 * - The click, nav, console and net lanes reach `pushFlightEvent` through
 *   the queue's `pushEvent` when no session is live: the same capture code
 *   and the same redaction as a recording, held instead of sent. A profile's
 *   `keepLane` may reduce or refuse each one first (the report face keeps
 *   metadata only). They are trimmed to the oldest kept snapshot (to the
 *   window when there is none) and to `maxLaneEvents`.
 * - Caps: `maxBytes` of serialized rrweb (each event measured at emit) and
 *   `maxEvents`. Over a cap the oldest window goes. When only the window
 *   being recorded is left over a cap, a fresh checkout is forced and the old
 *   window goes — rrweb's stream is stateful, so incrementals are NEVER
 *   spliced out; a fresh snapshot alone over the cap is dropped too and
 *   buffering resumes at the next checkout (or at the one a report takes,
 *   report.ts `holdReport`). Either way the clip says `truncated` until the
 *   lost stretch has left the window.
 * - Memory by default: a reload starts a fresh buffer. A `store` (capture
 *   profile `storage: browser` — storage/capture.ts, IndexedDB) also gets
 *   every window's new events every 2 s as one chunk, already masked (rrweb
 *   masks at emit, the lanes redact at capture), loses each window with the
 *   window, and hands this tab's surviving windows of earlier page loads
 *   back as `prior` on the next load. `clearFlight` empties memory and the
 *   store once a report is sent.
 *
 * DOM-free and React-free: the rrweb lane (capture/rrweb-lane.ts) feeds it.
 */
import type { eventWithTime } from '@rrweb/types';

import { isMetaEvent, redactUrl } from './capture/redact';
import { currentRoute } from './state';

export const FLIGHT_CHECKOUT_MS = 30_000;
export const FLIGHT_MAX_RRWEB_BYTES = 4 * 1024 * 1024;
export const FLIGHT_MAX_RRWEB_EVENTS = 20_000;
export const FLIGHT_MAX_LANE_EVENTS = 500;
/** How often a store receives the windows' new events. */
export const FLIGHT_PERSIST_MS = 2000;

/** rrweb's `EventType.FullSnapshot`; `@rrweb/types` is type-only here, so the value. */
const RRWEB_FULL_SNAPSHOT = 2;

/** One lane event as captured — stamped with its ORIGINAL time, no seq yet. */
export interface FlightLaneEvent {
  ts: string;
  tabId: string;
  tabHost: string;
  kind: string;
  payload?: Record<string, unknown>;
}

/** A window's place in time: all the retention rule reads. */
export interface FlightSpan {
  /** The page load that recorded it (`FLIGHT_LOAD` for this one). */
  load: string;
  /** Its Meta event's timestamp. */
  startMs: number;
  /** Its newest event's timestamp. */
  lastMs: number;
}

/** One checkout window: a Meta + FullSnapshot and what followed it. */
export interface FlightWindow extends FlightSpan {
  /** Unique; a store's key. */
  id: string;
  /** In capture order; empty for a window an earlier page load left in the store (`stored`). */
  events: eventWithTime[];
  /** How many events it holds (the store's count for a stored window). */
  count: number;
  /** UTF-8 bytes of the events' JSON. */
  bytes: number;
  /** The Meta event's (already redacted) page URL. */
  href: string;
  /**
   * The page's route when the window opened: the raw path through `redactUrl`,
   * so route-only rules apply (never re-derived from the scrubbed `href`).
   */
  route: string;
  /** Its events live only in the store (an earlier page load): read them there. */
  stored?: boolean;
}

/** A window as a store keeps it: its span and head, never its events. */
export interface StoredWindow extends FlightSpan {
  id: string;
  /** The tab (`currentRoute.tabId`) that recorded it; a report sends only its own tab's. */
  tab: string;
  count: number;
  bytes: number;
  href: string;
  route: string;
}

/**
 * Where a `storage: browser` profile keeps its windows besides memory. Every
 * write is queued in order from the synchronous capture path; a failure
 * drops the store for the rest of the page (memory carries on) and says so.
 */
export interface FlightStore {
  /** Write (or update) a window's head. */
  putWindow(w: StoredWindow): Promise<void>;
  /** One chunk of a window: its masked rrweb events (a JSON array) and the lane events captured meanwhile. */
  putChunk(windowId: string, part: number, events: string, lanes: readonly FlightLaneEvent[]): Promise<void>;
  /** Forget a window and its chunks. */
  dropWindow(windowId: string): Promise<void>;
  /** Forget every window of a tab (a report was sent). */
  clear(tab: string): Promise<void>;
}

/** What a buffer keeps, for how long, and where. */
export interface FlightProfile {
  /** How far back a clip reaches. */
  windowMs: number;
  /** rrweb's `checkoutEveryNms`: how often a fresh full snapshot opens a window. */
  checkoutMs: number;
  maxBytes: number;
  maxEvents: number;
  maxLaneEvents: number;
  /** Reduce a lane event before it is held; null refuses it. Absent = held as captured. */
  keepLane?: (kind: string, payload: Record<string, unknown> | undefined) => Record<string, unknown> | undefined | null;
  /** Keep the windows here too (browser storage); null/absent = memory only. */
  store?: FlightStore | null;
  /** This tab's windows an earlier page load left in the store (its sweep), oldest first. */
  prior?: readonly StoredWindow[];
}

/** The recorder face's idle last minute: memory only, 30 s windows. */
export const RECORDER_FLIGHT: FlightProfile = {
  windowMs: FLIGHT_CHECKOUT_MS,
  checkoutMs: FLIGHT_CHECKOUT_MS,
  maxBytes: FLIGHT_MAX_RRWEB_BYTES,
  maxEvents: FLIGHT_MAX_RRWEB_EVENTS,
  maxLaneEvents: FLIGHT_MAX_LANE_EVENTS,
};

/** What a report sends: oldest window first, lanes in capture order. */
export interface FlightClip {
  windows: FlightWindow[];
  lanes: FlightLaneEvent[];
  /** A cap dropped part of the window: the replay starts later than `windowMs` ago. */
  truncated: boolean;
}

/** This page load's id: windows of an earlier load (`prior`) carry theirs. */
export const FLIGHT_LOAD = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;

/**
 * Where a window stops covering the page: when the next window of the same
 * page load opens, else at its own last event (the page went away).
 */
export function windowEnd(w: FlightSpan, next: FlightSpan | undefined): number {
  return next && next.load === w.load ? next.startMs : w.lastMs;
}

const encoder = new TextEncoder();

let active = false;
/** Bumped on every start, so a capture begun in one buffer never lands in the next. */
let epoch = 0;
let profile: FlightProfile = RECORDER_FLIGHT;
let windows: FlightWindow[] = [];
let lanes: FlightLaneEvent[] = [];
/** Lane events a store has not received yet (they ride the next chunk of the newest window). */
let unstoredLanes: FlightLaneEvent[] = [];
/** Per window id: how many of its events the store holds, and its next chunk's part. */
const persisted = new Map<string, { events: number; parts: number }>();
/** Start of the oldest window left after a cap dropped one; null = nothing lost. */
let truncatedFrom: number | null = null;
/** The rrweb lane's checkout (a fresh full snapshot), while it feeds this buffer. */
let checkout: (() => void) | null = null;
let forcing = false;
let windowSeq = 0;
let store: FlightStore | null = null;
let persistTimer: ReturnType<typeof setInterval> | null = null;
let writes: Promise<void> = Promise.resolve();

/** Start a fresh buffer under `next` (default: the recorder face's last minute). */
export function startFlightBuffer(next: FlightProfile = RECORDER_FLIGHT): void {
  stopPersisting();
  active = true;
  epoch++;
  profile = next;
  store = next.store ?? null;
  windows = (next.prior ?? []).map((w) => ({
    id: w.id,
    load: w.load,
    startMs: w.startMs,
    lastMs: w.lastMs,
    events: [],
    count: w.count,
    bytes: w.bytes,
    href: w.href,
    route: w.route,
    stored: true,
  }));
  lanes = [];
  unstoredLanes = [];
  persisted.clear();
  truncatedFrom = null;
  enforce(Date.now());
  if (store) persistTimer = setInterval(persistFlightNow, FLIGHT_PERSIST_MS);
}

/** Stop buffering and forget everything held in memory; a store keeps its windows for the next load. */
export function stopFlightBuffer(): void {
  persistFlightNow();
  stopPersisting();
  active = false;
  store = null;
  windows = [];
  lanes = [];
  unstoredLanes = [];
  persisted.clear();
  truncatedFrom = null;
}

/** The profile the buffer runs under. */
export function flightProfile(): Readonly<FlightProfile> {
  return profile;
}

/** The rrweb lane registers its checkout while it feeds the buffer (null when it stops). */
export function setFlightCheckout(fn: (() => void) | null): void {
  checkout = fn;
}

/**
 * Empty the buffer — memory and this tab's stored windows — after a report
 * went out, and open a fresh window at once when rrweb is running.
 */
export function clearFlight(): void {
  if (!active) return;
  windows = [];
  lanes = [];
  unstoredLanes = [];
  persisted.clear();
  truncatedFrom = null;
  const tab = currentRoute.tabId;
  queueWrite((s) => s.clear(tab));
  checkout?.();
}

/** Settles once every queued store write has (the report face awaits it before reading). */
export function flightWrites(): Promise<void> {
  return writes;
}

/**
 * Hand the store every window's events it does not hold yet, as one chunk
 * per window (the lane events ride the newest one's). The 2 s timer calls
 * it; the report face calls it on pagehide. A no-op without a store.
 */
export function persistFlightNow(): void {
  if (!active || !store) return;
  const now = Date.now();
  enforce(now);
  trimLanes(now);
  const newest = windows.at(-1);
  for (const w of windows) {
    if (w.stored) continue;
    const p = persisted.get(w.id) ?? { events: 0, parts: 0 };
    const laneBatch = w === newest ? unstoredLanes : [];
    if (p.events === w.events.length && !laneBatch.length) continue;
    if (w === newest) unstoredLanes = [];
    const body = JSON.stringify(w.events.slice(p.events));
    const part = p.parts;
    persisted.set(w.id, { events: w.events.length, parts: part + 1 });
    const head = storedWindow(w);
    queueWrite(async (s) => {
      await s.putChunk(w.id, part, body, laneBatch);
      await s.putWindow(head);
    });
  }
}

function stopPersisting(): void {
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = null;
}

function storedWindow(w: FlightWindow): StoredWindow {
  return {
    id: w.id,
    tab: currentRoute.tabId,
    load: w.load,
    startMs: w.startMs,
    lastMs: w.lastMs,
    count: w.count,
    bytes: w.bytes,
    href: w.href,
    route: w.route,
  };
}

/** Queue one store write behind the others; the first failure drops the store, loudly, once. */
function queueWrite(op: (s: FlightStore) => Promise<void>): void {
  const s = store;
  if (!s) return;
  writes = writes
    .then(() => op(s))
    .catch((e: unknown) => {
      if (store !== s) return;
      store = null;
      stopPersisting();
      console.warn('vitrinka: browser capture storage failed — the capture stays in memory for this page', e);
    });
}

function dropWindow(i: number): void {
  const [w] = windows.splice(i, 1);
  if (!w) return;
  persisted.delete(w.id);
  queueWrite((s) => s.dropWindow(w.id));
}

/** Age, then caps: what `profile` allows the buffer to keep at `now`. */
function enforce(now: number): void {
  while (windows.length > 0) {
    const w = windows[0]!;
    const next = windows[1];
    // The window being recorded never ages out: it is the screen.
    if (!next && w.load === FLIGHT_LOAD) break;
    if (windowEnd(w, next) > now - profile.windowMs) break;
    dropWindow(0);
  }
  if (forcing) return; // the forced checkout's own events, re-entering
  let forced = false;
  while (windows.length > 0 && overCap()) {
    const live = windows.length === 1 && windows[0]!.load === FLIGHT_LOAD;
    if (live && !forced && checkout) {
      // Only the window being recorded is left and it is over: shrink by a
      // fresh full snapshot (never by splicing incrementals); the old window
      // goes on the next turn of the loop.
      forced = true;
      forcing = true;
      try {
        checkout();
      } finally {
        forcing = false;
      }
      if (windows.length > 1) continue;
    }
    dropWindow(0);
    truncatedFrom = windows[0]?.startMs ?? now;
  }
}

export function flightActive(): boolean {
  return active;
}

/** The capture target id while buffering (the net lane binds in-flight requests to it), else null. */
export function flightTarget(): string | null {
  return active ? `flight:${epoch}` : null;
}

/** Lane events older than the oldest kept snapshot go — older than the window when there is none. */
function trimLanes(now: number): void {
  const from = windows[0]?.startMs ?? now - profile.windowMs;
  const keep = lanes.findIndex((e) => Date.parse(e.ts) >= from);
  if (keep === -1) lanes = [];
  else if (keep > 0) lanes = lanes.slice(keep);
}

function overCap(): boolean {
  let bytes = 0;
  let count = 0;
  for (const w of windows) {
    bytes += w.bytes;
    count += w.count;
  }
  return bytes > profile.maxBytes || count > profile.maxEvents;
}

/** One rrweb event, already redacted. Events before this page's first snapshot are dropped. */
export function pushFlightRRWeb(ev: eventWithTime): void {
  if (!active) return;
  const oldest = windows[0];
  if (isMetaEvent(ev)) {
    // rrweb stamps the Meta event synchronously: the document is still on its page.
    const path = globalThis.location?.pathname ?? currentRoute.pathname;
    const opened: FlightWindow = {
      id: `${FLIGHT_LOAD}.${++windowSeq}`,
      load: FLIGHT_LOAD,
      startMs: ev.timestamp,
      lastMs: ev.timestamp,
      events: [],
      count: 0,
      bytes: 0,
      href: ev.data.href,
      route: redactUrl(path),
    };
    windows.push(opened);
    const head = storedWindow(opened);
    queueWrite((s) => s.putWindow(head));
  }
  const current = windows.at(-1);
  if (!current || current.load !== FLIGHT_LOAD) return;
  current.events.push(ev);
  current.count++;
  current.lastMs = Math.max(current.lastMs, ev.timestamp);
  current.bytes += encoder.encode(JSON.stringify(ev)).length;
  enforce(ev.timestamp);
  if (windows[0] !== oldest) trimLanes(ev.timestamp);
}

/** One lane event (the queue's idle path). Returns its ts, null when not buffering or refused. */
export function pushFlightEvent(
  kind: string,
  payload: Record<string, unknown> | undefined,
  route: { tabId: string; tabHost: string },
): string | null {
  if (!active) return null;
  const kept = profile.keepLane ? profile.keepLane(kind, payload) : payload;
  if (kept === null) return null;
  const ts = new Date().toISOString();
  const ev: FlightLaneEvent = { ts, tabId: route.tabId, tabHost: route.tabHost, kind, payload: kept };
  const max = profile.maxLaneEvents;
  lanes.push(ev);
  if (lanes.length > max) lanes.splice(0, lanes.length - max);
  if (store) {
    unstoredLanes.push(ev);
    if (unstoredLanes.length > max) unstoredLanes.splice(0, unstoredLanes.length - max);
  }
  return ts;
}

/** A copy of what the buffer holds now (it keeps rolling); null when not buffering. */
export function takeFlightClip(): FlightClip | null {
  if (!active) return null;
  const now = Date.now();
  enforce(now);
  trimLanes(now);
  return {
    windows: windows.map((w) => ({ ...w, events: w.events.slice() })),
    lanes: lanes.slice(),
    truncated: truncatedFrom !== null && truncatedFrom > now - profile.windowMs,
  };
}

/** Does the clip hold a window that opens on a Meta + FullSnapshot — a screen to replay? */
export function clipHasSnapshot(clip: FlightClip): boolean {
  return clip.windows.some((w) => w.events[1]?.type === RRWEB_FULL_SNAPSHOT);
}
