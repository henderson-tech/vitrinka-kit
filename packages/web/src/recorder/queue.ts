/**
 * Durable event queue — a port of the Expo recorder's queue (itself a port of
 * the browser extension's design), adapted to the browser:
 *
 * - A synchronous KV store (./storage — localStorage by default, memory when
 *   that is unavailable) holds the session record and the event buffer:
 *   reads/writes complete in one JS tick, so no async mutex is needed. Only
 *   flush() needs single-flight guarding (its POST is async) and it removes
 *   exactly the sent seqs on return.
 * - rrweb batches ride as CHUNKS the way the extension sends them: each batch
 *   is serialized once, split under the server's chunk cap, uploaded to
 *   `/chunk?seq=N` under a pre-allocated seq, and only then does its `rrweb`
 *   event row (payload {count}, blobKey) join the event stream — keeping its
 *   originally allocated seq (gap-fill), retried oldest-first AHEAD of the
 *   event flush. Chunks are kept in memory (they can be megabytes; the KV
 *   store is small) and persisted best-effort under a byte budget.
 * - A permanent server verdict (4xx minus 408/429) drops the item loudly;
 *   transient failures stop the pass and the next flush retries.
 * - A reload keeps the undelivered event tail (KV store is durable).
 * - Reconciliation (extension D5/D9): a 10s poll asks the server what it
 *   actually holds (`serverMaxSeq`) and whether the session still exists.
 *   Only the SERVER's verdict (404 / done / deleted / permanent events
 *   rejection) marks a session dead — flushing then stops instead of
 *   retrying into a session that can never accept another event.
 * - health() (extension D4): honest by construction — "synced" means the
 *   server confirmed it holds everything this recorder allocated, not
 *   merely "my last POST returned 200".
 */
import type { RedactionPolicy } from '@vitrinka/redact';

import type { RecorderEvent } from '../protocol';
import { api, permanentStatus, uploadChunk, VitrinkaApiError } from './api';
import { notify } from './state';
import { getRecorderStorage } from './storage';

const FLUSH_MS = 2000;
const MAX_BUFFER = 20000;
const MAX_PENDING = 200; // rrweb chunks in memory; oldest evicted loudly
/**
 * Byte budgets for ONE events POST, mirroring the extension's pack-margin /
 * hard-cap split. The server rejects bodies over 4 MiB and 400 is a
 * PERMANENT verdict — so an oversized batch must never be assembled. An event
 * bigger than the pack margin but under the wire cap is still deliverable —
 * it rides ALONE; only one beyond the wire cap can never upload and is
 * dropped.
 */
const WIRE_BODY_CAP = 4 * 1024 * 1024;
const MAX_BATCH_BYTES = 3 * 1024 * 1024; // pack margin
const MAX_EVENT_BYTES = WIRE_BODY_CAP - 1024; // solo cap; headroom for the {"events":[…]} envelope
/**
 * rrweb chunk budgets (extension `splitRRWebEvents`): the server's chunk cap
 * is 12 MiB; batches pack under 10 MiB, an event too big to pack rides alone
 * up to the wire cap, and one beyond even that is undeliverable.
 */
const CHUNK_WIRE_CAP = 12 * 1024 * 1024;
const CHUNK_PACK_BYTES = 10 * 1024 * 1024;
const CHUNK_HARD_BYTES = CHUNK_WIRE_CAP - 64;
/** Pending chunks are persisted only while their total stays under this. */
const CHUNK_PERSIST_BUDGET = 1024 * 1024;

const encoder = new TextEncoder();

/** UTF-8 byte length of a string — the unit the server's body limit counts. */
function utf8Bytes(s: string): number {
  return encoder.encode(s).length;
}

/** How often a live session reconciles against the server (extension D5). */
export const RECONCILE_MS = 10_000;
// Health thresholds (extension D4): quiet until one of these trips.
const OFFLINE_AFTER_MS = 15_000;
const BACKLOG_ITEMS = 40;

const kv = () => getRecorderStorage();

export interface SessionState {
  sessionId: string;
  project: string;
  environment: string;
  title: string;
  /** Server-minted board link; "Open board" uses it verbatim. */
  boardUrl?: string;
  seq: number;
  paused: boolean;
  /** Active-time bookkeeping: elapsed = activeMs + (now - resumeAt while running). */
  activeMs: number;
  resumeAt: string | null;
  /**
   * The SERVER will not accept this session's events any more (extension D9):
   * 404 / done / deleted from the reconcile poll, or a permanent verdict on
   * the events POST. Capture and flushing stop; Stop completes locally.
   * Durable so a reload cannot resurrect the pointless retry loop.
   */
  dead?: boolean;
  deadReason?: string;
  /**
   * The workspace redaction policy fetched at session start (null = fetch
   * failed ⇒ the engine's safe defaults). Durable WITH the session so a
   * reload re-applies the same rules instead of silently reverting.
   */
  policy?: RedactionPolicy | null;
}

export type { RecorderEvent };

interface PendingChunk {
  seq: number;
  ts: string;
  tabId: string;
  tabHost: string;
  sessionId: string;
  /** Number of rrweb events inside `body`. */
  count: number;
  /** The serialized JSON array — uploaded verbatim. */
  body: string;
}

function readJson<T>(key: string, fallback: T): T {
  const raw = kv().getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** A quota-refusing store must never break capture — warn once and go on. */
let storageWarned = false;
function safeSet(key: string, value: string): boolean {
  try {
    kv().set(key, value);
    return true;
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      console.warn('vitrinka: storage write failed — the queue tail is memory-only until it clears', e);
    }
    return false;
  }
}

// The session record is small and read on every event — cache it in memory and
// write through, so the capture hot path never parses JSON.
let recCache: SessionState | null | undefined;

/**
 * The LIVE session record — a mutable alias of the cache, not a copy. Treat it
 * as READ-ONLY unless you pass the object you mutated straight to `setState()`
 * in the same tick.
 */
export function getState(): SessionState | null {
  if (recCache === undefined) recCache = readJson<SessionState | null>('rec', null);
  return recCache;
}

export function setState(rec: SessionState | null): void {
  recCache = rec;
  if (rec === null) kv().remove('rec');
  else safeSet('rec', JSON.stringify(rec));
}

/**
 * The event buffer lives in memory and is FLUSHED TO STORAGE on a debounce
 * (plus synchronously whenever it is read for upload or the session ends).
 */
const PERSIST_DEBOUNCE_MS = 700;

let bufferCache: RecorderEvent[] | undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function getBuffer(): RecorderEvent[] {
  if (bufferCache === undefined) bufferCache = readJson<RecorderEvent[]>('buffer', []);
  return bufferCache;
}

/** Write the in-memory buffer (and the pending chunks) to storage NOW. */
export function persistNow(): void {
  persistBuffer();
  persistChunks();
}

function persistBuffer(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (bufferCache !== undefined) safeSet('buffer', JSON.stringify(bufferCache));
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistBuffer();
    persistChunks();
  }, PERSIST_DEBOUNCE_MS);
}

function setBuffer(buffer: RecorderEvent[]): void {
  bufferCache = buffer;
  persistBuffer();
}

// -- pending rrweb chunks ----------------------------------------------------

let chunkCache: PendingChunk[] | undefined;
let chunkBytes = 0;

function getChunks(): PendingChunk[] {
  if (chunkCache === undefined) {
    chunkCache = readJson<PendingChunk[]>('chunks', []);
    chunkBytes = chunkCache.reduce((n, c) => n + c.body.length, 0);
  }
  return chunkCache;
}

/** Best-effort: persisted while small, memory-only (and said so) beyond the budget. */
function persistChunks(): void {
  const chunks = getChunks();
  if (chunks.length === 0) {
    kv().remove('chunks');
    return;
  }
  if (chunkBytes > CHUNK_PERSIST_BUDGET) {
    kv().remove('chunks');
    return;
  }
  safeSet('chunks', JSON.stringify(chunks));
}

function setChunks(chunks: PendingChunk[]): void {
  chunkCache = chunks;
  chunkBytes = chunks.reduce((n, c) => n + c.body.length, 0);
  persistChunks();
}

export function queuedCount(): number {
  return getBuffer().length + getChunks().length;
}

// -- health + server reconciliation (extension D4/D5/D9) ---------------------

let lastSyncAt = 0;
let lastError = '';
let failures = 0;
/** Highest seq the SERVER confirmed (events-POST 200 or reconcile GET). */
let serverMaxSeq = -1;

function noteSync(): void {
  lastSyncAt = Date.now();
  failures = 0;
  lastError = '';
}

function noteFailure(e: unknown): void {
  failures++;
  lastError = String(e instanceof Error ? e.message : e).slice(0, 200);
}

/** Fresh-session baseline; called by startSession before capture begins. */
export function resetHealth(baseSeq = 0): void {
  lastSyncAt = Date.now();
  lastError = '';
  failures = 0;
  serverMaxSeq = baseSeq;
}

export type RecorderHealthState = 'idle' | 'ok' | 'backlog' | 'offline' | 'dead';

export interface RecorderHealth {
  state: RecorderHealthState;
  queued: number;
  failures: number;
  error: string;
  sinceSyncMs: number | null;
  localSeq: number;
  serverMaxSeq: number;
  /** The reconciliation itself: the server accounts for every allocated seq. */
  synced: boolean;
  deadReason: string;
}

export function health(): RecorderHealth {
  const rec = getState();
  const queued = queuedCount();
  const sinceSync = lastSyncAt ? Date.now() - lastSyncAt : null;
  let state: RecorderHealthState = 'idle';
  if (rec) {
    if (rec.dead) state = 'dead';
    else if (failures >= 2 || (queued > 0 && sinceSync !== null && sinceSync > OFFLINE_AFTER_MS))
      state = 'offline';
    else if (queued > BACKLOG_ITEMS) state = 'backlog';
    else state = 'ok';
  }
  return {
    state,
    queued,
    failures,
    error: lastError,
    sinceSyncMs: sinceSync,
    localSeq: rec?.seq ?? 0,
    serverMaxSeq,
    synced: rec !== null && !rec.dead && serverMaxSeq >= rec.seq && queued === 0,
    deadReason: rec?.dead ? (rec.deadReason ?? '') : '',
  };
}

/**
 * Record that the SERVER will not accept this session's events any more
 * (extension D9). Freezes the HUD clock and stops the retry loop; the durable
 * tail stays until Stop.
 */
export function markSessionDead(reason: string): void {
  const rec = getState();
  if (!rec || rec.dead) return;
  rec.dead = true;
  rec.deadReason = reason;
  if (!rec.paused && rec.resumeAt) {
    rec.activeMs = (rec.activeMs || 0) + (Date.now() - Date.parse(rec.resumeAt));
    rec.resumeAt = null;
  }
  setState(rec);
  console.warn('vitrinka: session marked dead —', reason);
  notify();
}

/** Ask the server what it actually holds (extension D5/D9). */
export async function reconcile(): Promise<void> {
  const rec = getState();
  if (!rec || rec.dead) return;
  let ses: { maxSeq?: number; status?: string; deletedAt?: string | null };
  try {
    ses = await api('GET', `/api/v1/sessions/${rec.sessionId}`);
  } catch (e) {
    if (e instanceof VitrinkaApiError && e.status === 404) {
      markSessionDead('session no longer exists on the server');
      return;
    }
    noteFailure(e);
    notify();
    return;
  }
  if (getState()?.sessionId !== rec.sessionId) return; // stopped while the GET was in flight
  noteSync();
  serverMaxSeq = Math.max(serverMaxSeq, Number(ses.maxSeq ?? 0));
  if (ses.status === 'done' || ses.deletedAt) {
    markSessionDead(ses.deletedAt ? 'session was deleted' : 'session was closed on the server');
    return;
  }
  notify();
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

export function armReconcile(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    void reconcile();
  }, RECONCILE_MS);
}

export function disarmReconcile(): void {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
}

/** Allocate `count` consecutive seqs without emitting events; null when not capturing. */
export function allocSeq(count = 1): { seq: number; sessionId: string } | null {
  const rec = getState();
  if (!rec || rec.paused || rec.dead || count < 1) return null;
  const first = rec.seq + 1;
  rec.seq += count;
  setState(rec);
  return { seq: first, sessionId: rec.sessionId };
}

/**
 * In-flight CAPTURES (async network body reads) that have not yet appended
 * their event. Stop must settle these before draining.
 */
const inFlightCaptures = new Set<Promise<void>>();

export function trackCapture(p: Promise<void>): Promise<void> {
  inFlightCaptures.add(p);
  return p
    .catch(() => undefined)
    .finally(() => {
      inFlightCaptures.delete(p);
    });
}

export const CAPTURES_SETTLE_MS = 5000;

/** Wait for in-flight captures, bounded; false when stragglers were abandoned. */
export async function capturesSettled(deadlineMs = CAPTURES_SETTLE_MS): Promise<boolean> {
  const t0 = Date.now();
  let guard = 0;
  while (inFlightCaptures.size > 0 && guard++ < 50) {
    const remaining = deadlineMs - (Date.now() - t0);
    if (remaining <= 0) break;
    const timeout = new Promise<void>((res) => setTimeout(res, remaining));
    await Promise.race([Promise.allSettled([...inFlightCaptures]), timeout]);
  }
  if (inFlightCaptures.size > 0) {
    const stuck = inFlightCaptures.size;
    inFlightCaptures.clear();
    console.warn(
      `vitrinka: ${stuck} capture(s) still in flight after ${Date.now() - t0}ms — abandoned, proceeding without them`,
    );
    return false;
  }
  return true;
}

/** Is `id` the session currently in state AND still accepting capture? */
export function isSessionLive(id: string): boolean {
  const rec = getState();
  return rec !== null && rec.sessionId === id && !rec.dead;
}

/**
 * Append an event to the durable buffer (drops when no live session or
 * paused). `tabId`/`tabHost`/`ts`/`seq` are filled here; capture layers pass
 * kind+payload plus the route they observed. Returns the stamped ts (null
 * when dropped).
 */
export function pushEvent(
  kind: string,
  payload: Record<string, unknown> | undefined,
  route: { tabId: string; tabHost: string },
): string | null {
  const rec = getState();
  if (!rec || rec.paused || rec.dead) return null;
  rec.seq++;
  const ts = new Date().toISOString();
  const buffer = getBuffer();
  buffer.push({ seq: rec.seq, ts, tabId: route.tabId, tabHost: route.tabHost, kind, payload });
  if (buffer.length > MAX_BUFFER) {
    const dropped = buffer.length - MAX_BUFFER;
    buffer.splice(0, dropped);
    console.warn(`vitrinka: retry buffer full — dropped ${dropped} oldest events`);
  }
  noteActivity();
  schedulePersist();
  setState(rec);
  scheduleFlush();
  return ts;
}

/** Push a fully-formed event (chunk rows carry a pre-allocated seq). */
export function pushRawEvent(ev: RecorderEvent): void {
  getBuffer().push(ev);
  noteActivity();
  schedulePersist();
  scheduleFlush();
}

// -- idle tracking -----------------------------------------------------------

let lastEventAt = Date.now();

function noteActivity(): void {
  lastEventAt = Date.now();
}

export function idleMs(): number {
  return Date.now() - lastEventAt;
}

export function resetIdle(): void {
  noteActivity();
}

// -- rrweb chunks ------------------------------------------------------------

/**
 * Split a batch of rrweb events into size-bounded, in-order parts (extension
 * `splitRRWebEvents`). Returns the serialized bodies and the byte sizes of
 * events that are alone beyond the wire cap (undeliverable).
 */
export function splitRRWebEvents(
  events: readonly unknown[],
  packBytes = CHUNK_PACK_BYTES,
  hardBytes = CHUNK_HARD_BYTES,
): { parts: { count: number; body: string }[]; dropped: number[] } {
  const parts: { count: number; body: string }[] = [];
  const dropped: number[] = [];
  let curStrs: string[] = [];
  let curBytes = 2; // "[]"
  const flushPart = () => {
    if (!curStrs.length) return;
    parts.push({ count: curStrs.length, body: `[${curStrs.join(',')}]` });
    curStrs = [];
    curBytes = 2;
  };
  for (const ev of events) {
    const s = JSON.stringify(ev);
    const b = utf8Bytes(s) + 1;
    if (b > hardBytes) {
      dropped.push(b);
      continue;
    }
    if (b > packBytes) {
      flushPart();
      parts.push({ count: 1, body: `[${s}]` });
      continue;
    }
    if (curStrs.length && curBytes + b > packBytes) flushPart();
    curStrs.push(s);
    curBytes += b;
  }
  flushPart();
  return { parts, dropped };
}

/**
 * Queue a batch of rrweb events as chunks under pre-allocated seqs. Dropped
 * (undeliverable) events surface as a ⚠ note on the timeline, as the
 * extension does. Returns the number of chunks queued (0 when not capturing).
 */
export function pushRRWebBatch(
  events: readonly unknown[],
  route: { tabId: string; tabHost: string },
): number {
  if (!events.length) return 0;
  const rec = getState();
  if (!rec || rec.paused || rec.dead) return 0;
  const { parts, dropped } = splitRRWebEvents(events);
  for (const b of dropped) {
    console.warn(`vitrinka: rrweb event (${b} bytes) exceeds the chunk cap — dropped`);
    pushEvent(
      'note',
      {
        text: `⚠ rrweb event dropped (${(b / 1048576).toFixed(1)} MiB > chunk cap) — replay may be incomplete from here`,
      },
      route,
    );
  }
  const alloc = parts.length ? allocSeq(parts.length) : null;
  if (!alloc) return 0;
  const chunks = getChunks();
  const ts = new Date().toISOString();
  parts.forEach((p, i) => {
    chunks.push({
      seq: alloc.seq + i,
      ts,
      tabId: route.tabId,
      tabHost: route.tabHost,
      sessionId: alloc.sessionId,
      count: p.count,
      body: p.body,
    });
    chunkBytes += p.body.length;
  });
  while (chunks.length > MAX_PENDING) {
    const drop = chunks.shift();
    if (drop) chunkBytes -= drop.body.length;
    console.warn(`vitrinka: pending chunk queue full — dropped rrweb chunk seq ${drop?.seq}`);
  }
  noteActivity();
  schedulePersist();
  scheduleFlush();
  return parts.length;
}

/**
 * Upload queued chunks oldest-first. Items are BOUND to their originating
 * session; stale-session items drop loudly. Returns true when the queue is
 * empty.
 */
async function drainPending(limit = 5): Promise<boolean> {
  const chunks = getChunks();
  if (chunks.length === 0) return true;
  const rec = getState();
  let done = 0;
  const gone = new Set<number>();
  for (const item of chunks) {
    if (done >= limit) break;
    done++;
    if (!rec || item.sessionId !== rec.sessionId) {
      console.warn(`vitrinka: dropping rrweb chunk seq ${item.seq} from ended session ${item.sessionId}`);
      gone.add(item.seq);
      continue;
    }
    try {
      const up = await uploadChunk(rec.sessionId, item.seq, item.body);
      // The event row joins the buffer only now, keeping its original seq —
      // a late retry fills the stream's gap.
      pushRawEvent({
        seq: item.seq,
        ts: item.ts,
        tabId: item.tabId,
        tabHost: item.tabHost,
        kind: 'rrweb',
        payload: { count: item.count },
        blobKey: up.blobKey,
      });
      noteSync();
      gone.add(item.seq);
    } catch (e) {
      if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
        console.warn(`vitrinka: rrweb chunk seq ${item.seq} rejected permanently (${e.status}) — dropped`);
        gone.add(item.seq);
        continue;
      }
      noteFailure(e);
      console.warn('vitrinka: chunk upload failed', e);
      break; // transient — stop the pass, the next flush retries
    }
  }
  if (gone.size) setChunks(getChunks().filter((c) => !gone.has(c.seq)));
  return getChunks().length === 0;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

let flushBusy = false;

/** Single-flight flush; true when the events POST succeeded (or nothing to send). */
export async function flush(opts: { keepalive?: boolean } = {}): Promise<boolean> {
  if (flushBusy) return false;
  flushBusy = true;
  try {
    return await flushInner(opts);
  } finally {
    flushBusy = false;
  }
}

async function flushInner(opts: { keepalive?: boolean }): Promise<boolean> {
  if (getState()?.dead) return false;
  const pendingClear = await drainPending();
  if (!pendingClear) scheduleFlush();
  const rec = getState();
  const buffer = getBuffer();
  if (!rec || buffer.length === 0) return pendingClear;
  const batch: RecorderEvent[] = [];
  const oversized = new Set<number>();
  let batchBytes = 0;
  // A keepalive POST (pagehide) is capped by the browser at 64 KiB.
  const packCap = opts.keepalive ? 60 * 1024 : MAX_BATCH_BYTES;
  for (const ev of buffer) {
    if (batch.length >= 500) break;
    const b = utf8Bytes(JSON.stringify(ev)) + 1;
    if (b > MAX_EVENT_BYTES) {
      console.warn(`vitrinka: event seq ${ev.seq} (${b} bytes) exceeds the wire cap — dropped`);
      oversized.add(ev.seq);
      continue;
    }
    if (b > packCap) {
      if (opts.keepalive) break; // too big for keepalive — the next document's flush takes it
      if (batch.length === 0) {
        batch.push(ev);
        batchBytes = b;
      }
      break; // send what precedes it first (or it alone) — FIFO preserved
    }
    if (batch.length > 0 && batchBytes + b > packCap) break;
    batch.push(ev);
    batchBytes += b;
  }
  if (oversized.size) {
    setBuffer(getBuffer().filter((ev) => !oversized.has(ev.seq)));
    if (!batch.length) {
      scheduleFlush();
      return false;
    }
  }
  if (!batch.length) return false;
  persistBuffer();
  try {
    await api('POST', `/api/v1/sessions/${rec.sessionId}/events`, { events: batch }, opts);
  } catch (e) {
    if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
      markSessionDead(`server rejected this session (${e.status})`);
      return false;
    }
    noteFailure(e);
    notify();
    console.warn('vitrinka: flush failed, retrying', e);
    scheduleFlush();
    return false;
  }
  noteSync();
  serverMaxSeq = Math.max(serverMaxSeq, batch[batch.length - 1]?.seq ?? serverMaxSeq);
  notify();
  // Remove EXACTLY the sent seqs — events pushed during the in-flight POST survive.
  const sent = new Set(batch.map((e) => e.seq));
  const rest = getBuffer().filter((e) => !sent.has(e.seq));
  setBuffer(rest);
  if (rest.length) scheduleFlush();
  return true;
}

/** Drain until buffer + chunks are empty or the deadline passes. */
export async function drainBuffer(deadlineMs = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    if (getBuffer().length === 0 && getChunks().length === 0) return true;
    const sent = await flush();
    if (getState()?.dead) return false;
    if (!sent) await new Promise<void>((res) => setTimeout(res, 1000));
  }
  console.warn('vitrinka: drain timed out — remaining events stay queued');
  return false;
}

/** Reset buffers for a fresh session. */
export function resetQueues(): void {
  setBuffer([]);
  setChunks([]);
}

/** Test-only: drop all module state so suites cannot leak into each other. */
export function __resetForTests(): void {
  __dropCachesForTests();
  inFlightCaptures.clear();
  kv().remove('rec');
  kv().remove('buffer');
  kv().remove('chunks');
  resetIdle();
}

/** Test-only: the recorded events currently buffered (in order). */
export function __bufferForTests(): RecorderEvent[] {
  return getBuffer();
}

/** Test-only: the pending chunks (in order). */
export function __chunksForTests(): { seq: number; count: number; sessionId: string }[] {
  return getChunks().map((c) => ({ seq: c.seq, count: c.count, sessionId: c.sessionId }));
}

/** Test-only: drop the in-memory caches while LEAVING storage intact (a reload). */
export function __dropCachesForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushBusy = false;
  recCache = undefined;
  bufferCache = undefined;
  chunkCache = undefined;
  chunkBytes = 0;
  disarmReconcile();
  lastSyncAt = 0;
  lastError = '';
  failures = 0;
  serverMaxSeq = -1;
}
