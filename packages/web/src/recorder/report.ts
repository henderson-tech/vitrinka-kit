/**
 * "Report a bug" (react-recorder decisions D9–D11): the gate that runs the
 * idle pill's flight recorder (flight.ts), and the report it files.
 *
 * - The gate: the flight buffer runs while a pill is mounted (`wantFlight`),
 *   the device can record at all (a key or a link), the host did not pass
 *   `flightRecorder: false`, and no session is live. Arming fetches the
 *   workspace policy FIRST, so the buffer captures under the recording's own
 *   rules from its first byte; the provider starts rrweb's flight mode once
 *   `flightActive()`.
 * - Report while idle: the clip frozen when the sheet opened (`holdReport`)
 *   is filed as one short session under the pill's credential — create
 *   `{meta.kind: "report", devicePixelRatio}` → the lane events with their
 *   ORIGINAL timestamps (led by a nav to the page the first snapshot shows,
 *   as a recording is led by its start nav) → the rrweb windows as chunks →
 *   the description as a task annotation stamped at Send → PATCH done.
 *   Straight through the API client, never the durable queue: nothing is
 *   persisted before Send, and a report never becomes "the" recording. A
 *   failed step keeps the job, and Retry resumes it in the same session (the
 *   server ignores a seq it already holds).
 * - Report while recording: the description is a task annotation in the live
 *   session; no clip.
 */
import type { RecorderEvent, SessionDone } from '../protocol';
import { api, fetchPolicy, uploadChunk } from './api';
import { setRedactionPolicy } from './capture/redact';
import { recorderConfig, vitrinkaLinked } from './config';
import { type FlightClip, flightActive, startFlightBuffer, stopFlightBuffer, takeFlightClip } from './flight';
import { EVENTS_PER_POST, getState, MAX_BATCH_BYTES, splitRRWebEvents, utf8Bytes } from './queue';
import { noteRecent } from './recents';
import { addAnnotation, createSession, imagePixels, type ViewRect } from './session';
import { currentRoute, notify } from './state';

// -- the gate ----------------------------------------------------------------

let pills = 0;
let armed = false;
let generation = 0;
let arming: Promise<void> = Promise.resolve();

/** A mounted pill wants the flight recorder; returns the release. */
export function wantFlight(): () => void {
  pills++;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pills--;
    notify();
  };
}

function flightWanted(): boolean {
  return pills > 0 && getState() === null && vitrinkaLinked() && recorderConfig().flightRecorder !== false;
}

/**
 * Arm or disarm the flight recorder to match the gate; the provider calls it
 * on every recorder change. Resolves once a pending arm has settled.
 */
export function syncFlight(): Promise<void> {
  const want = flightWanted();
  if (want && !armed) {
    armed = true;
    const gen = ++generation;
    setRedactionPolicy(null);
    // fetchPolicy never rejects: null is the engine's safe defaults.
    arming = fetchPolicy().then((policy) => {
      if (!armed || gen !== generation) return;
      setRedactionPolicy(policy);
      startFlightBuffer();
      notify();
    });
  } else if (!want && armed) {
    armed = false;
    generation++;
    stopFlightBuffer();
    // A session that just started owns the rules now; only an idle page resets them.
    if (getState() === null) setRedactionPolicy(null);
  }
  return arming;
}

/** Can the pill offer "Report a bug" now — into the live session, or with the idle clip? */
export function canReport(): boolean {
  const rec = getState();
  if (rec) return !rec.paused && !rec.dead;
  return flightWanted() && flightActive();
}

// -- the report --------------------------------------------------------------

export interface ReportNote {
  /** The description; its first line titles the report session. */
  text: string;
  /** The region the reporter marked, viewport CSS px; null = the whole viewport. */
  rect: ViewRect | null;
  /** The marked element's selector; '' for a region or no mark. */
  selector: string;
}

interface ReportChunk {
  seq: number;
  ts: string;
  tabId: string;
  tabHost: string;
  count: number;
  body: string;
}

interface ReportJob {
  title: string;
  /** The start nav and the lane events, seq 1..n. */
  events: RecorderEvent[];
  chunks: ReportChunk[];
  note: RecorderEvent;
  durationMs: number;
  sessionId: string;
  boardUrl?: string;
  /** Steps completed; a retry resumes at the next one. */
  done: number;
}

let held: FlightClip | null = null;
let job: ReportJob | null = null;
let sending = false;

/**
 * The report sheet opened (freeze the last minute — the buffer itself keeps
 * rolling) or was dismissed (drop it, and a report whose send failed). A
 * send in flight is never dropped. Idle only.
 */
export function holdReport(on: boolean): void {
  if (!sending) job = null;
  held = on && getState() === null ? takeFlightClip() : null;
}

const TITLE_LINE_CAP = 100;

function reportTitle(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? '';
  return `Bug report: ${line.length > TITLE_LINE_CAP ? `${line.slice(0, TITLE_LINE_CAP - 1)}…` : line}`;
}

function viewportRect(): ViewRect {
  return { x: 0, y: 0, w: globalThis.innerWidth || 0, h: globalThis.innerHeight || 0 };
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return currentRoute.pathname;
  }
}

function buildJob(clip: FlightClip, note: ReportNote): ReportJob {
  const tab = { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost };
  const events: RecorderEvent[] = [];
  let seq = 0;
  const first = clip.windows[0];
  const startMs = first?.events[0]?.timestamp;
  if (first && startMs !== undefined) {
    events.push({ seq: ++seq, ts: new Date(startMs).toISOString(), ...tab, kind: 'nav', payload: { url: first.href, route: pathOf(first.href) } });
  }
  for (const e of clip.lanes) {
    events.push({ seq: ++seq, ts: e.ts, tabId: e.tabId, tabHost: e.tabHost, kind: e.kind, ...(e.payload ? { payload: e.payload } : {}) });
  }
  const chunks: ReportChunk[] = [];
  let endMs = startMs ?? 0;
  for (const w of clip.windows) {
    // A window is ≤ 4 MiB (the flight cap), far under the chunk cap: nothing drops.
    let at = 0;
    for (const p of splitRRWebEvents(w.events).parts) {
      at += p.count;
      const lastMs = w.events[at - 1]?.timestamp ?? endMs;
      endMs = Math.max(endMs, lastMs);
      chunks.push({ seq: ++seq, ts: new Date(lastMs).toISOString(), ...tab, count: p.count, body: p.body });
    }
  }
  const lastLane = clip.lanes.at(-1);
  if (lastLane) endMs = Math.max(endMs, Date.parse(lastLane.ts));
  return {
    title: reportTitle(note.text),
    events,
    chunks,
    note: {
      seq: ++seq,
      ts: new Date().toISOString(),
      ...tab,
      kind: 'note',
      payload: {
        text: note.text,
        rect: imagePixels(note.rect ?? viewportRect()),
        selector: note.selector,
        annotate: true,
        task: true,
        route: currentRoute.pathname,
      },
    },
    durationMs: startMs !== undefined ? Math.max(0, endMs - startMs) : 0,
    sessionId: '',
    done: 0,
  };
}

/** POST events in batches under the server's per-POST count and the queue's pack margin. */
async function postEvents(sessionId: string, events: readonly RecorderEvent[]): Promise<void> {
  let batch: RecorderEvent[] = [];
  let bytes = 0;
  const send = async () => {
    if (!batch.length) return;
    await api('POST', `/api/v1/sessions/${sessionId}/events`, { events: batch });
    batch = [];
    bytes = 0;
  };
  for (const ev of events) {
    const b = utf8Bytes(JSON.stringify(ev)) + 1;
    if (batch.length >= EVENTS_PER_POST || (batch.length > 0 && bytes + b > MAX_BATCH_BYTES)) await send();
    batch.push(ev);
    bytes += b;
  }
  await send();
}

const steps: readonly ((j: ReportJob) => Promise<void>)[] = [
  async (j) => {
    const ses = await createSession(j.title, { meta: { kind: 'report' } });
    j.sessionId = ses.id;
    if (ses.boardUrl) j.boardUrl = ses.boardUrl;
  },
  (j) => postEvents(j.sessionId, j.events),
  async (j) => {
    // The extension's chunk path: upload under the pre-allocated seq, then the row.
    const rows: RecorderEvent[] = [];
    for (const c of j.chunks) {
      const up = await uploadChunk(j.sessionId, c.seq, c.body);
      rows.push({ seq: c.seq, ts: c.ts, tabId: c.tabId, tabHost: c.tabHost, kind: 'rrweb', payload: { count: c.count }, blobKey: up.blobKey });
    }
    await postEvents(j.sessionId, rows);
  },
  (j) => postEvents(j.sessionId, [j.note]),
  async (j) => {
    const done = await api<SessionDone>('PATCH', `/api/v1/sessions/${j.sessionId}`, { status: 'done' });
    const url = done.board?.url;
    if (url) j.boardUrl = url;
  },
];

/**
 * File the report. While recording: a task annotation in the live session.
 * Idle: the held clip as a `kind: "report"` session — rejects with the
 * failing step's error, and a second call (Retry) resumes the same job.
 */
export async function sendReport(note: ReportNote): Promise<{ boardUrl?: string }> {
  const rec = getState();
  if (rec) {
    if (rec.paused || rec.dead) throw new Error('the recording is not capturing — resume it to report');
    addAnnotation(note.text, note.rect ?? viewportRect(), note.selector, { task: true });
    return rec.boardUrl ? { boardUrl: rec.boardUrl } : {};
  }
  if (sending) throw new Error('a report is already being sent');
  if (!job) {
    if (!held) throw new Error('nothing to report — the last minute was not recorded');
    job = buildJob(held, note);
    held = null;
  }
  const j = job;
  sending = true;
  try {
    for (; j.done < steps.length; j.done++) {
      const step = steps[j.done];
      if (step) await step(j);
    }
  } finally {
    sending = false;
  }
  if (job === j) job = null;
  noteRecent({
    sessionId: j.sessionId,
    title: j.title,
    startedAt: Date.now(),
    durationMs: j.durationMs,
    status: 'saved',
    ...(j.boardUrl ? { boardUrl: j.boardUrl } : {}),
  });
  return j.boardUrl ? { boardUrl: j.boardUrl } : {};
}

/** The provider unmounted: forget the buffer and any held clip; a remount re-arms. */
export function dropFlight(): void {
  armed = false;
  generation++;
  arming = Promise.resolve();
  held = null;
  if (!sending) job = null;
  stopFlightBuffer();
}

/** Test-only. */
export function __resetReportForTests(): void {
  pills = 0;
  sending = false;
  dropFlight();
}
