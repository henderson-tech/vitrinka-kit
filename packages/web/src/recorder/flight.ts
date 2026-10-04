/**
 * The flight recorder (react-recorder decisions D9/D10): while the pill is
 * mounted and idle, the last minute of the page lives HERE, in memory only —
 * never in storage, never on the network — so "Report a bug" can send what
 * led up to it (report.ts). A reload starts a fresh buffer.
 *
 * - rrweb runs with `checkoutEveryNms: 30 s`; every Meta event (rrweb emits
 *   one at the head of each full snapshot) opens a window, and only the
 *   current and the previous window are kept — so a clip always starts at a
 *   Meta + FullSnapshot and covers the last 30–60 s.
 * - The click, nav, console and net lanes reach `pushFlightEvent` through
 *   the queue's `pushEvent` when no session is live: the same capture code
 *   and the same redaction as a recording, held instead of sent. They are
 *   trimmed to the oldest kept snapshot.
 * - Caps: ≤ 4 MiB of serialized rrweb (each event measured at emit), ≤ 20 000
 *   rrweb events, ≤ 500 lane events. Over an rrweb cap the older window goes;
 *   a window over a cap on its own goes too, and buffering resumes at the
 *   next checkout (a clip must open on a full snapshot).
 *
 * DOM-free and React-free: the rrweb lane (capture/rrweb.ts) feeds it.
 */
import type { eventWithTime } from '@rrweb/types';

import { isMetaEvent } from './capture/redact';

export const FLIGHT_CHECKOUT_MS = 30_000;
export const FLIGHT_MAX_RRWEB_BYTES = 4 * 1024 * 1024;
export const FLIGHT_MAX_RRWEB_EVENTS = 20_000;
export const FLIGHT_MAX_LANE_EVENTS = 500;

/** One lane event as captured — stamped with its ORIGINAL time, no seq yet. */
export interface FlightLaneEvent {
  ts: string;
  tabId: string;
  tabHost: string;
  kind: string;
  payload?: Record<string, unknown>;
}

/** One checkout window: a Meta + FullSnapshot and what followed it. */
export interface FlightWindow {
  events: eventWithTime[];
  /** UTF-8 bytes of the events' JSON. */
  bytes: number;
  /** The Meta event's (already redacted) page URL. */
  href: string;
}

/** What a report sends: oldest window first, lanes in capture order. */
export interface FlightClip {
  windows: FlightWindow[];
  lanes: FlightLaneEvent[];
}

const encoder = new TextEncoder();

let active = false;
/** Bumped on every start, so a capture begun in one buffer never lands in the next. */
let epoch = 0;
let windows: FlightWindow[] = [];
let lanes: FlightLaneEvent[] = [];

/** Start a fresh, empty buffer. */
export function startFlightBuffer(): void {
  active = true;
  epoch++;
  windows = [];
  lanes = [];
}

/** Stop buffering and forget everything held. */
export function stopFlightBuffer(): void {
  active = false;
  windows = [];
  lanes = [];
}

export function flightActive(): boolean {
  return active;
}

/** The capture target id while buffering (the net lane binds in-flight requests to it), else null. */
export function flightTarget(): string | null {
  return active ? `flight:${epoch}` : null;
}

function oldestSnapshotMs(): number | undefined {
  return windows[0]?.events[0]?.timestamp;
}

function trimLanes(): void {
  const from = oldestSnapshotMs();
  if (from === undefined) return;
  const keep = lanes.findIndex((e) => Date.parse(e.ts) >= from);
  if (keep === -1) lanes = [];
  else if (keep > 0) lanes = lanes.slice(keep);
}

function overCap(): boolean {
  let bytes = 0;
  let count = 0;
  for (const w of windows) {
    bytes += w.bytes;
    count += w.events.length;
  }
  return bytes > FLIGHT_MAX_RRWEB_BYTES || count > FLIGHT_MAX_RRWEB_EVENTS;
}

/** One rrweb event, already redacted. Events before the first snapshot are dropped. */
export function pushFlightRRWeb(ev: eventWithTime): void {
  if (!active) return;
  const oldest = windows[0];
  if (isMetaEvent(ev)) {
    windows.push({ events: [], bytes: 0, href: ev.data.href });
    if (windows.length > 2) windows.shift();
  }
  const current = windows.at(-1);
  if (!current) return;
  current.events.push(ev);
  current.bytes += encoder.encode(JSON.stringify(ev)).length;
  while (windows.length > 0 && overCap()) windows.shift();
  if (windows[0] !== oldest) trimLanes();
}

/** One lane event (the queue's idle path). Returns its ts, null when not buffering. */
export function pushFlightEvent(
  kind: string,
  payload: Record<string, unknown> | undefined,
  route: { tabId: string; tabHost: string },
): string | null {
  if (!active) return null;
  const ts = new Date().toISOString();
  lanes.push({ ts, tabId: route.tabId, tabHost: route.tabHost, kind, payload });
  if (lanes.length > FLIGHT_MAX_LANE_EVENTS) lanes.splice(0, lanes.length - FLIGHT_MAX_LANE_EVENTS);
  return ts;
}

/** A copy of what the buffer holds now (it keeps rolling); null when not buffering. */
export function takeFlightClip(): FlightClip | null {
  if (!active) return null;
  trimLanes();
  return {
    windows: windows.map((w) => ({ ...w, events: w.events.slice() })),
    lanes: lanes.slice(),
  };
}
