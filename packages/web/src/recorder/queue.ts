/**
 * Durable event queue — a port of the Expo recorder's queue (itself a port of
 * the browser extension's design), adapted to the browser:
 *
 * - A synchronous KV store (./storage — localStorage by default, memory when
 *   that is unavailable) holds the session record and the event buffer:
 *   seq allocation is serialized across tabs by the driver's lock, reading
 *   the shared watermark inside it. flush() is single-flight within each
 *   document and removes exactly the sent seqs on return.
 * - rrweb batches ride as CHUNKS the way the extension sends them: each batch
 *   is serialized once, split under the server's chunk cap, uploaded to
 *   `/chunk?seq=N` under a pre-allocated seq, and only then does its `rrweb`
 *   event row (payload {count}, blobKey) join the event stream — keeping its
 *   originally allocated seq (gap-fill), retried oldest-first AHEAD of the
 *   event flush. Chunks are kept in memory (they can be megabytes; the KV
 *   store is small) and persisted best-effort under a byte budget.
 * - A note's attached images (recorder attachments) ride the same way: the
 *   note and its images take ONE allocation — the images' seqs first, the
 *   note's last, its payload listing theirs — and each image uploads to
 *   `/shot?seq=N` before its `attachment` row (blobKey) joins the stream.
 *   Their bytes wait in the blob journal (./storage/blobs — IndexedDB), so a
 *   queued image survives a reload and is uploaded before its row is
 *   delivered; they leave it once the server acknowledged the row. The
 *   capture journal of such a note is written only once those bytes are in
 *   (another tab must never recover an image it cannot read yet) and lives
 *   until every one of its seqs is acknowledged, so a reload or another tab
 *   can finish the lot.
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

import type { AttachmentPayload, RecorderEvent } from '../protocol';
import { api, permanentStatus, uploadChunk, uploadImage, VitrinkaApiError } from './api';
import type { StagedImage } from './attachments';
import { pushFlightEvent } from './flight';
import { notify } from './state';
import { getRecorderStorage } from './storage';
import { getRecorderBlobStore } from './storage/blobs';

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
export const MAX_BATCH_BYTES = 3 * 1024 * 1024; // pack margin
/** The server's per-POST event cap. */
export const EVENTS_PER_POST = 500;
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
export function utf8Bytes(s: string): number {
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
  /**
   * The same read's `attachments` (recorder attachments D6): the sheets take
   * images only on true. Durable with the session, like `policy`.
   */
  attachments?: boolean;
  /**
   * When (ISO) another tab last renewed its claim to be stopping this
   * session: the copy it stores reads as paused with its clock frozen at the
   * Stop, so every other tab stops capturing and painting rec at once, not
   * when the save ends. The stopping tab renews the mark every
   * `STOPPING_RENEW_MS` for as long as its Stop is out (however long a
   * request hangs); pause and resume are refused on a mark younger than
   * `STOPPING_TTL_MS` (`stoppingElsewhere`). An older one outlived its tab
   * and is an ordinary pause. Stop always works.
   */
  stopping?: string;
}

/** How often a tab renews its `stopping` mark while its Stop is out. */
export const STOPPING_RENEW_MS = 20_000;
/** A mark not renewed for this long outlived its tab: several missed renewals, and past the one wake a minute Chrome allows a long-hidden tab. */
export const STOPPING_TTL_MS = 90_000;

/** Is another tab still stopping `rec` (a fresh `stopping` mark)? */
export function stoppingElsewhere(rec: SessionState): boolean {
  return rec.stopping !== undefined && Date.now() - Date.parse(rec.stopping) < STOPPING_TTL_MS;
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

/** An attached image waiting for its `/shot` upload; its row joins the stream after. */
interface PendingImage {
  seq: number;
  ts: string;
  tabId: string;
  tabHost: string;
  sessionId: string;
  /** Its bytes' key in the blob journal. */
  blob: string;
  payload: AttachmentPayload;
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

/** Storage key of the session record — shared by every tab of the origin. */
export const REC_KEY = 'rec';

// The session record is small and read on every event — cache it in memory and
// write through, so the capture hot path never parses JSON.
let recCache: SessionState | null | undefined;

/**
 * The LIVE session record — a mutable alias of the cache, not a copy. Treat it
 * as READ-ONLY unless you pass the object you mutated straight to `setState()`
 * in the same tick.
 */
export function getState(): SessionState | null {
  if (recCache === undefined) recCache = readJson<SessionState | null>(REC_KEY, null);
  return recCache;
}

export function setState(rec: SessionState | null): void {
  recCache = rec;
  if (rec === null) kv().remove(REC_KEY);
  else safeSet(REC_KEY, JSON.stringify(stored(rec)));
}

/** The session this tab is stopping, its clock at the Stop, and when its mark was last renewed. */
let stoppingHere: { sessionId: string; activeMs: number; at: string } | null = null;
let stoppingLease: ReturnType<typeof setInterval> | null = null;

/** What the other tabs read of `rec`: while this tab stops it, the frozen `stopping` copy. */
function stored(rec: SessionState): SessionState {
  if (stoppingHere?.sessionId !== rec.sessionId) return rec;
  return { ...rec, paused: true, activeMs: stoppingHere.activeMs, resumeAt: null, stopping: stoppingHere.at };
}

/**
 * This tab started (`sessionId`) or finished (null) stopping a session. Only
 * the STORED record changes: this tab's own cache stays live, so the tail
 * its Stop still drains (rrweb's last events, settled captures) lands.
 * Finishing writes the record back without the mark.
 */
export function markStopping(sessionId: string | null, activeMs = 0, renewMs = STOPPING_RENEW_MS): void {
  const was = stoppingHere?.sessionId;
  if (stoppingLease) clearInterval(stoppingLease);
  stoppingLease = null;
  stoppingHere = sessionId ? { sessionId, activeMs, at: new Date().toISOString() } : null;
  // The lease: a Stop whose request hangs is still this tab's, never mistaken for a gone tab's.
  if (sessionId) stoppingLease = setInterval(() => renewStopping(sessionId), renewMs);
  const live = getState();
  if (!live || (live.sessionId !== sessionId && live.sessionId !== was)) return;
  delete live.stopping;
  setState(live);
}

/** Re-stamp this tab's `stopping` mark while its Stop is still out. */
function renewStopping(sessionId: string): void {
  if (stoppingHere?.sessionId !== sessionId) return;
  stoppingHere.at = new Date().toISOString();
  const live = getState();
  if (live?.sessionId === sessionId) setState(live);
}

export type StoredChange = 'joined' | 'updated' | 'ended' | 'unchanged';

const beforeStopHooks = new Set<() => void>();

export function onBeforeStop(fn: () => void): () => void {
  beforeStopHooks.add(fn);
  return () => beforeStopHooks.delete(fn);
}

export function runBeforeStopHooks(): void {
  for (const fn of beforeStopHooks) {
    try { fn(); }
    catch (error) { console.warn('vitrinka: before-stop hook failed', error); }
  }
}

/**
 * Another document of this origin (a second tab) wrote the session record.
 * The store is shared, this cache is not — a tab that joined a recording on
 * load would otherwise keep painting and capturing it after another tab
 * stopped it. So: a stop there ends the session here, dropping this tab's
 * undelivered tail (the server no longer accepts it); a session started
 * there is joined, as a reload joins it; the same session takes the stored
 * record (a pause, a dead verdict) but never a lower seq than this tab
 * already allocated. Nothing is written back.
 */
export function adoptStoredState(raw: string | null): StoredChange {
  let next: SessionState | null = null;
  if (raw) {
    try {
      next = JSON.parse(raw) as SessionState;
    } catch {
      return 'unchanged';
    }
  }
  const cur = getState();
  // Allocations also read storage before its notification arrives. Ship the
  // already-captured DOM tail while the local cache still accepts it.
  if (next?.stopping && next.sessionId === cur?.sessionId && !cur.paused && stoppingHere?.sessionId !== next.sessionId) runBeforeStopHooks();
  if (!next) {
    if (!cur) return 'unchanged';
    recCache = null;
    dropLocalTail();
    disarmReconcile();
    return 'ended';
  }
  if (cur?.sessionId === next.sessionId) {
    next.seq = Math.max(next.seq, cur.seq);
    // A policy this tab already holds outlives a record written before it.
    if (next.policy === undefined && cur.policy !== undefined) next.policy = cur.policy;
    if (next.attachments === undefined && cur.attachments !== undefined) next.attachments = cur.attachments;
    // A session this tab is stopping comes back as the frozen copy it wrote
    // (another tab wrote its cache back): this tab's clock and capture stay live.
    if (stoppingHere?.sessionId === next.sessionId) {
      next.paused = cur.paused;
      next.activeMs = cur.activeMs;
      next.resumeAt = cur.resumeAt;
      delete next.stopping;
    }
    recCache = next;
    return 'updated';
  }
  recCache = next;
  // A tail this tab still held belongs to another session, never to this one.
  dropLocalTail();
  return 'joined';
}

/**
 * The event buffer lives in memory and is FLUSHED TO STORAGE on a debounce
 * (plus synchronously whenever it is read for upload or the session ends).
 */
const PERSIST_DEBOUNCE_MS = 700;

let bufferCache: RecorderEvent[] | undefined;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * This tab let go of its tail for another tab's session (dropLocalTail): its
 * empty caches must not overwrite the stored tail that tab owns — not even
 * on pagehide — until this tab queues work of its own again.
 */
let tailDropped = false;

function getBuffer(): RecorderEvent[] {
  if (bufferCache === undefined) bufferCache = readJson<RecorderEvent[]>('buffer', []);
  return bufferCache;
}

/** Write the in-memory buffer (and the pending chunks) to storage NOW. */
export function persistNow(): void {
  for (const item of pendingAllocations) {
    if (!item.persisted) item.persisted = safeSet(item.key, JSON.stringify({ draft: item.draft, seq: item.seq }));
  }
  persistBuffer();
  persistChunks();
  persistImages();
}

function persistBuffer(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (bufferCache !== undefined && !tailDropped) safeSet('buffer', JSON.stringify(bufferCache));
}

function schedulePersist(): void {
  tailDropped = false;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistBuffer();
    persistChunks();
  }, PERSIST_DEBOUNCE_MS);
}

function setBuffer(buffer: RecorderEvent[]): void {
  bufferCache = buffer;
  tailDropped = false;
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
  if (tailDropped) return;
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
  tailDropped = false;
  persistChunks();
}

// -- attached images ---------------------------------------------------------

/** The pending images' metadata (small: their bytes are in the blob journal). */
let imageCache: PendingImage[] | undefined;
/** Bytes this document holds itself, by journal key — no journal read to upload them. */
const imageBlobs = new Map<string, Blob>();
/** Journal keys whose bytes are not (yet) known to be in a durable journal. */
const unjournaled = new Set<string>();
/** Uploaded images whose row awaits the server's ack: row seq → journal key, deleted on ack. */
const rowBlobs = new Map<number, string>();
/** Journal reads refused in a row, by key: a journal that never answers must not hold Stop forever. */
const readFailures = new Map<string, number>();
const READ_ATTEMPTS = 5;
/**
 * The queued images' budget across notes (one note holds ≤ 10): past either
 * bound the oldest goes loudly and its note lands without it — a tester
 * attaching on while offline never grows memory and the journal unbounded.
 */
const MAX_IMAGES = 200;
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
let imageNo = 0;
let volatileWarned = false;
/** KV mark: the blob journal may hold something (spares IndexedDB for testers who never attach). */
const BLOBS_KEY = 'blobs';

function getImages(): PendingImage[] {
  imageCache ??= readJson<PendingImage[]>('images', []);
  return imageCache;
}

/**
 * Always persisted: metadata only — and only of images whose bytes are in
 * the blob journal, the one place the next document can read them from.
 */
function persistImages(): void {
  if (tailDropped) return;
  const images = getImages().filter((image) => !unjournaled.has(image.blob));
  if (images.length === 0) kv().remove('images');
  else safeSet('images', JSON.stringify(images));
}

function setImages(images: PendingImage[]): void {
  imageCache = images;
  tailDropped = false;
  persistImages();
}

/**
 * Hold a note's images for the queue: their bytes in memory for this
 * document and in the blob journal for a reload or another tab. Returns
 * the drafts the capture journal records (journal key + payload), and
 * `journaled` — true once every image's bytes are durably in the journal:
 * only then may anything outside this document be told about them.
 */
function stageImages(sessionId: string, images: readonly StagedImage[]): { drafts: ImageDraft[]; journaled: Promise<boolean> } {
  const store = getRecorderBlobStore();
  if (!store.durable && !volatileWarned) {
    volatileWarned = true;
    console.warn('vitrinka: no IndexedDB — an attached image will not survive a reload');
  }
  safeSet(BLOBS_KEY, '1');
  const writes: Promise<boolean>[] = [];
  const drafts = images.map(({ blob, payload }) => {
    const key = `${sessionId}/${RECORDER_DOCUMENT_KEY}.${++imageNo}`;
    imageBlobs.set(key, blob);
    unjournaled.add(key);
    writes.push(store.put(key, blob).then(
      () => {
        // Released (or acknowledged) while the write was out: nothing will read it back.
        const needed = imageBlobs.has(key) || getImages().some((image) => image.blob === key) || [...rowBlobs.values()].includes(key);
        if (!needed) {
          unjournaled.delete(key);
          forgetBlob(key);
          return false;
        }
        if (!store.durable) return false;
        unjournaled.delete(key);
        if (getImages().some((image) => image.blob === key)) persistImages();
        return true;
      },
      (error: unknown) => {
        console.warn('vitrinka: an attached image could not be journaled — it will not survive a reload', error);
        return false;
      },
    ));
    return { blob: key, payload };
  });
  return { drafts, journaled: Promise.all(writes).then((durable) => durable.every(Boolean)) };
}

/** Delete one image's bytes from the blob journal. */
function forgetBlob(key: string): void {
  void getRecorderBlobStore()
    .delete(key)
    .catch((error: unknown) => console.warn('vitrinka: blob journal delete failed', error));
}

/** Let go of images nothing here will upload; `journal` also deletes their bytes there. */
function releaseImages(keys: Iterable<string>, journal: boolean): void {
  for (const key of keys) {
    imageBlobs.delete(key);
    unjournaled.delete(key);
    readFailures.delete(key);
    if (journal) forgetBlob(key);
  }
}

const draftImageKeys = (draft: CaptureDraft): string[] => (draft.kind === 'event' ? (draft.images ?? []).map((i) => i.blob) : []);

/**
 * Delete journaled images nothing will upload: `ended`'s (a session just
 * stopped), or, without it, every session's but the live one.
 */
export async function pruneBlobJournal(ended?: string): Promise<void> {
  if (!kv().getString(BLOBS_KEY)) return;
  const store = getRecorderBlobStore();
  const live = getState()?.sessionId;
  try {
    const keys = await store.keys();
    let kept = 0;
    for (const key of keys) {
      const drop = ended ? key.startsWith(`${ended}/`) : !live || !key.startsWith(`${live}/`);
      if (drop) await store.delete(key);
      else kept++;
    }
    if (kept === 0 && !getState()) kv().remove(BLOBS_KEY);
  } catch (error) {
    console.warn('vitrinka: blob journal cleanup failed', error);
  }
}

export function queuedCount(): number {
  recoverAllocations();
  pruneAcknowledgedCaptures();
  return getBuffer().length + getChunks().length + getImages().length + pendingAllocations.size;
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
  /** Of `queued`, the rrweb chunks still pending upload. */
  chunks: number;
  failures: number;
  error: string;
  sinceSyncMs: number | null;
  /** Epoch ms of the last confirmed delivery or reconcile (null before any). */
  lastSyncAt: number | null;
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
    chunks: getChunks().length,
    failures,
    error: lastError,
    sinceSyncMs: sinceSync,
    lastSyncAt: lastSyncAt || null,
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

/** Allocate inside the storage driver's lock; lifecycle writes cannot rewind its watermark. */
function allocSeq(count: number): { seq: number; sessionId: string } | null {
  const rec = getState();
  if (!rec || rec.dead || count < 1) return null;
  const watermark = readJson<{ sessionId: string; seq: number } | null>('seq', null);
  const first = Math.max(rec.seq, watermark?.sessionId === rec.sessionId ? watermark.seq : 0) + 1;
  // This write must succeed before a seq can be used in another document.
  // On failure the capture stays pending and retries rather than colliding.
  kv().set('seq', JSON.stringify({ sessionId: rec.sessionId, seq: first + count - 1 }));
  rec.seq = first + count - 1;
  setState(rec);
  return { seq: first, sessionId: rec.sessionId };
}

/** Document identity is not sessionStorage: duplicated tabs copy that store. */
export const RECORDER_DOCUMENT_KEY = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
const ALLOCATION_PREFIX = 'allocation.';
let captureNo = 0;
/** One attached image as the capture journal records it: its bytes stay in the blob journal. */
interface ImageDraft { blob: string; payload: AttachmentPayload }
type CaptureDraft = { sessionId: string; ts: string; tabId: string; tabHost: string } & (
  /** `images`: a note's attachments — their seqs come first, the event's last. */
  | { kind: 'event'; event: { kind: string; payload?: Record<string, unknown> }; images?: readonly ImageDraft[] }
  | { kind: 'chunk'; part: { count: number; body: string } }
);
/** `seq` is the FIRST of the draft's seqs (`seqCount` of them). */
interface StoredAllocation { draft: CaptureDraft; seq?: number }
interface PendingAllocation extends StoredAllocation { key: string; persisted: boolean; bytes: number }
const pendingAllocations = new Set<PendingAllocation>();
const MAX_ALLOCATION_BYTES = 16 * 1024 * 1024;
let allocationBytes = 0;
let allocationChunks = 0;
/** Per capture journal: the seqs it still waits on; the journal goes once none is left. */
const allocatedCaptures = new Map<string, { sessionId: string; seqs: Set<number>; persisted: boolean }>();

/** How many seqs a capture takes: one, or a note's images + the note. */
function seqCount(draft: CaptureDraft): number {
  return draft.kind === 'event' ? 1 + (draft.images?.length ?? 0) : 1;
}

function seqsFrom(first: number, draft: CaptureDraft): Set<number> {
  return new Set(Array.from({ length: seqCount(draft) }, (_, i) => first + i));
}
let allocationsRecovered = false;
let allocationBusy: Promise<void> | null = null;

function removeAllocation(item: PendingAllocation): void {
  if (!pendingAllocations.delete(item)) return;
  allocationBytes -= item.bytes;
  if (item.draft.kind === 'chunk') allocationChunks--;
}

function addAllocation(item: PendingAllocation): void {
  pendingAllocations.add(item);
  allocationBytes += item.bytes;
  if (item.draft.kind === 'chunk') allocationChunks++;
  while (pendingAllocations.size > MAX_BUFFER || allocationBytes > MAX_ALLOCATION_BYTES || allocationChunks > MAX_PENDING) {
    const oldest = pendingAllocations.values().next().value!;
    removeAllocation(oldest);
    kv().remove(oldest.key);
    releaseImages(draftImageKeys(oldest.draft), true);
    const error = new Error('vitrinka: pending allocation budget full — oldest capture dropped');
    noteFailure(error);
    console.warn(error.message);
  }
}

/** Journals survive pagehide and are safe for another document to help drain. */
function recoverAllocations(refresh = false): void {
  if (allocationsRecovered && !refresh) return;
  allocationsRecovered = true;
  const storage = kv();
  if (!storage.withLock) return;
  const queuedKeys = new Set([...pendingAllocations].map((item) => item.key));
  for (const key of storage.keys?.() ?? []) {
    if (!key.startsWith(ALLOCATION_PREFIX) || queuedKeys.has(key) || allocatedCaptures.has(key)) continue;
    const item = readJson<StoredAllocation | null>(key, null);
    if (item && item.draft && item.draft.sessionId === getState()?.sessionId) addAllocation({ ...item, key, persisted: true, bytes: utf8Bytes(JSON.stringify(item)) });
  }
}

/** `seq` is the capture's first: a note's images take it and the next ones, the note the last. */
function appendCapture(draft: CaptureDraft, seq: number): void {
  const { ts, tabId, tabHost, sessionId } = draft;
  if (draft.kind === 'event') {
    const images = draft.images ?? [];
    const own = seq + images.length;
    const event = images.length
      ? { ...draft.event, payload: { ...draft.event.payload, attachments: images.map((_, i) => seq + i) } }
      : draft.event;
    const buffer = getBuffer();
    if (!buffer.some((e) => e.seq === own)) buffer.push({ seq: own, ts, tabId, tabHost, ...event });
    if (images.length) {
      const pending = getImages();
      images.forEach((image, i) => {
        const at = seq + i;
        if (pending.some((p) => p.seq === at)) return;
        // Already uploaded, its row waits in the buffer (a reload restored it):
        // its bytes still leave the journal on that row's ack.
        if (buffer.some((e) => e.seq === at)) {
          rowBlobs.set(at, image.blob);
          return;
        }
        pending.push({ seq: at, ts, tabId, tabHost, sessionId, blob: image.blob, payload: image.payload });
      });
      let bytes = pending.reduce((sum, p) => sum + p.payload.bytes, 0);
      while (pending.length > MAX_IMAGES || bytes > MAX_IMAGE_BYTES) {
        const dropped = pending.shift()!;
        bytes -= dropped.payload.bytes;
        clearStoredCaptures(dropped.sessionId, new Set([dropped.seq]));
        releaseImages([dropped.blob], true);
        console.warn(`vitrinka: attached image queue full — dropped ${dropped.payload.name} (seq ${dropped.seq}); its note lands without it`);
      }
      setImages(pending);
    }
    if (buffer.length > MAX_BUFFER) {
      const dropped = buffer.splice(0, buffer.length - MAX_BUFFER);
      clearStoredCaptures(sessionId, new Set(dropped.map((event) => event.seq)));
      console.warn(`vitrinka: retry buffer full — dropped ${dropped.length} oldest events`);
    }
  } else {
    const chunks = getChunks();
    if (!chunks.some((chunk) => chunk.seq === seq) && !getBuffer().some((event) => event.seq === seq)) {
      chunks.push({ seq, ts, tabId, tabHost, sessionId, ...draft.part });
      chunkBytes += draft.part.body.length;
    }
    while (chunks.length > MAX_PENDING) {
      const dropped = chunks.shift()!;
      chunkBytes -= dropped.body.length;
      clearStoredCaptures(sessionId, new Set([dropped.seq]));
      console.warn(`vitrinka: pending chunk queue full — dropped rrweb chunk seq ${dropped.seq}`);
    }
  }
  schedulePersist();
  scheduleFlush();
}

/** `seqs` were acknowledged (or dropped): a journal none of whose seqs is left goes. */
function clearStoredCaptures(sessionId: string, seqs: ReadonlySet<number>): void {
  for (const [key, item] of allocatedCaptures) {
    if (item.sessionId !== sessionId) continue;
    // A journal holds one seq, or a note's few: walk its own, never the batch.
    for (const seq of item.seqs) if (seqs.has(seq)) item.seqs.delete(seq);
    if (item.seqs.size === 0) {
      kv().remove(key);
      allocatedCaptures.delete(key);
      const documentKey = key.slice(ALLOCATION_PREFIX.length, key.lastIndexOf('.'));
      const peerKey = `tab.${documentKey}`;
      const peer = readJson<{ departed?: boolean; recoverable?: boolean } | null>(peerKey, null);
      if (peer?.departed && peer.recoverable && !kv().keys?.().some((k) => k.startsWith(`${ALLOCATION_PREFIX}${documentKey}.`))) kv().remove(peerKey);
    }
  }
}

/** Helpers remove a journal only after ack; the original tab may still cache its retry. */
function pruneAcknowledgedCaptures(): void {
  const delivered = new Set<number>();
  for (const [key, item] of allocatedCaptures) {
    if (item.persisted && !kv().getString(key)) {
      for (const seq of item.seqs) delivered.add(seq);
      allocatedCaptures.delete(key);
    }
  }
  if (!delivered.size) return;
  setBuffer(getBuffer().filter((event) => !delivered.has(event.seq)));
  setChunks(getChunks().filter((chunk) => !delivered.has(chunk.seq)));
  const images = getImages();
  if (images.some((image) => delivered.has(image.seq))) {
    // The helper uploaded them and deletes their bytes on its own ack.
    releaseImages(images.filter((image) => delivered.has(image.seq)).map((image) => image.blob), false);
    setImages(images.filter((image) => !delivered.has(image.seq)));
  }
}

/** A departing document can be acknowledged by a helper only with a full journal. */
export function tailIsDurable(): boolean {
  if (!kv().keys) return false;
  const durableSeqs = new Set([...allocatedCaptures].filter(([key]) => kv().getString(key)).flatMap(([, item]) => [...item.seqs]));
  for (const item of pendingAllocations) {
    if (item.persisted && item.seq !== undefined && kv().getString(item.key)) for (const seq of seqsFrom(item.seq, item.draft)) durableSeqs.add(seq);
  }
  // An image's bytes must be in the blob journal too, or a helper has nothing to upload.
  const bytesDurable = (key: string) => !unjournaled.has(key);
  return [...pendingAllocations].every((item) => item.persisted && !!kv().getString(item.key) && draftImageKeys(item.draft).every(bytesDurable))
    && getBuffer().every((event) => durableSeqs.has(event.seq))
    && getChunks().every((chunk) => durableSeqs.has(chunk.seq))
    && getImages().every((image) => durableSeqs.has(image.seq) && bytesDurable(image.blob));
}

/** One worker per document: evicted drafts cannot stay held by queued lock callbacks. */
function allocatePending(): Promise<void> {
  if (allocationBusy) return allocationBusy;
  const storage = kv();
  allocationBusy = trackCapture(Promise.resolve().then(async () => {
    for (const item of pendingAllocations) {
      await storage.withLock!('seq', () => {
        if (!pendingAllocations.has(item)) return;
        if (item.persisted) {
          const saved = readJson<StoredAllocation | null>(item.key, null);
          // Another tab already delivered this journal; never allocate it twice.
          if (!saved) {
            removeAllocation(item);
            releaseImages(draftImageKeys(item.draft), false);
            return;
          }
          item.seq = saved.seq;
        }
        adoptStoredState(storage.getString(REC_KEY) ?? null);
        if (getState()?.sessionId !== item.draft.sessionId) {
          removeAllocation(item);
          releaseImages(draftImageKeys(item.draft), true);
          return;
        }
        const seq = item.seq ?? allocSeq(seqCount(item.draft))?.seq;
        if (seq === undefined) return;
        item.seq = seq;
        // Keep the payload AND its identity until the server acknowledges it.
        // A recovering document reuses this seq even when the old tab is alive.
        if (item.persisted) storage.set(item.key, JSON.stringify({ draft: item.draft, seq }));
        allocatedCaptures.set(item.key, { sessionId: item.draft.sessionId, seqs: seqsFrom(seq, item.draft), persisted: item.persisted });
        appendCapture(item.draft, seq);
        removeAllocation(item);
      });
    }
  }).catch((error: unknown) => {
    noteFailure(error);
    console.warn('vitrinka: seq allocation failed — capture kept for retry', error);
    scheduleFlush();
    notify();
    throw error;
  })).finally(() => { allocationBusy = null; });
  return allocationBusy;
}

/**
 * Accept now, persist now, stamp under the shared lock later. A note with
 * images (`journaled`) persists its journal only once their bytes are in
 * the blob journal: another tab recovering it sooner would read no bytes
 * and drop them as lost. Until then (for good, when the bytes never get
 * there) only this document can deliver it.
 */
function queueCapture(draft: CaptureDraft, journaled?: Promise<boolean>): boolean {
  const accepted = getState();
  if (!accepted || accepted.paused || accepted.dead) return false;
  recoverAllocations();
  if (kv().withLock) {
    const key = `${ALLOCATION_PREFIX}${RECORDER_DOCUMENT_KEY}.${++captureNo}`;
    const raw = JSON.stringify({ draft });
    const item: PendingAllocation = { key, draft, persisted: !journaled && safeSet(key, raw), bytes: utf8Bytes(raw) };
    addAllocation(item);
    void allocatePending();
    void journaled?.then((durable) => {
      if (durable) publishAllocation(item);
    });
  } else {
    const allocation = allocSeq(seqCount(draft));
    if (allocation) appendCapture(draft, allocation.seq);
    else releaseImages(draftImageKeys(draft), true);
  }
  return true;
}

/**
 * Persist a capture's journal late (its images' bytes just landed), with
 * its seq when it has one. A capture delivered, dropped or reset meanwhile
 * is no longer held here, and nothing is written.
 */
function publishAllocation(item: PendingAllocation): void {
  const allocated = allocatedCaptures.get(item.key);
  if (allocated) allocated.persisted = safeSet(item.key, JSON.stringify({ draft: item.draft, seq: item.seq }));
  else if (pendingAllocations.has(item)) item.persisted = safeSet(item.key, JSON.stringify({ draft: item.draft }));
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

/**
 * Did this tab's session change while an upload for `rec` was out — ended
 * or replaced by another tab (adoptStoredState)? Then the upload's outcome
 * must not touch the queue, which belongs to the next session now.
 */
function movedOn(rec: SessionState): boolean {
  return getState()?.sessionId !== rec.sessionId;
}

/** Is `id` the session currently in state AND still accepting capture? */
export function isSessionLive(id: string): boolean {
  const rec = getState();
  return rec !== null && rec.sessionId === id && !rec.dead;
}

/**
 * Append an event to the durable buffer (drops while paused or dead).
 * `tabId`/`tabHost`/`ts`/`seq` are filled here; capture layers pass
 * kind+payload plus the route they observed. With no session the event goes
 * to the flight recorder when the idle pill keeps one (memory only — never
 * storage, never the network), else it is dropped. Returns the stamped ts
 * (null when dropped). `images` (a note's attachments, live sessions only)
 * take the seqs just before the event's, which lists them as `attachments`.
 */
export function pushEvent(
  kind: string,
  payload: Record<string, unknown> | undefined,
  route: { tabId: string; tabHost: string },
  images: readonly StagedImage[] = [],
): string | null {
  const rec = getState();
  if (!rec) return pushFlightEvent(kind, payload, route);
  if (rec.paused || rec.dead) return null;
  const ts = new Date().toISOString();
  const { tabId, tabHost } = route;
  const staged = images.length ? stageImages(rec.sessionId, images) : null;
  queueCapture(
    {
      sessionId: rec.sessionId,
      ts,
      tabId,
      tabHost,
      kind: 'event',
      event: { kind, payload },
      ...(staged ? { images: staged.drafts } : {}),
    },
    staged?.journaled,
  );
  noteActivity();
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
  const ts = new Date().toISOString();
  const { tabId, tabHost } = route;
  for (const part of parts) {
    if (!queueCapture({ sessionId: rec.sessionId, ts, tabId, tabHost, kind: 'chunk', part })) return 0;
  }
  noteActivity();
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
      // Another tab ended or replaced the session while this upload was out:
      // its tail is gone here, and nothing of it may re-enter the queue.
      if (movedOn(rec)) return getChunks().length === 0;
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
      if (movedOn(rec)) return getChunks().length === 0;
      if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
        console.warn(`vitrinka: rrweb chunk seq ${item.seq} rejected permanently (${e.status}) — dropped`);
        clearStoredCaptures(item.sessionId, new Set([item.seq]));
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

/**
 * Upload queued images oldest-first, the chunks' way: `/shot?seq=N` with the
 * bytes this document holds, else the blob journal's; only then does the
 * `attachment` row (payload, blobKey) join the stream under its original seq.
 * An image whose bytes are gone (never journaled before a reload) or that the
 * server refuses for good is dropped loudly — its note lands without it. A
 * refused journal READ is not gone bytes: it stops the pass like a transient
 * upload failure, and only READ_ATTEMPTS refusals in a row give the image up.
 * Returns true when no image is left.
 */
async function drainImages(limit = 4): Promise<boolean> {
  const images = getImages();
  if (images.length === 0) return true;
  const rec = getState();
  let done = 0;
  const gone = new Set<number>();
  const lost: string[] = [];
  for (const item of images) {
    if (done >= limit) break;
    done++;
    if (!rec || item.sessionId !== rec.sessionId) {
      console.warn(`vitrinka: dropping attachment seq ${item.seq} from ended session ${item.sessionId}`);
      gone.add(item.seq);
      lost.push(item.blob);
      continue;
    }
    let blob = imageBlobs.get(item.blob) ?? null;
    if (!blob) {
      try {
        blob = await getRecorderBlobStore().get(item.blob);
        readFailures.delete(item.blob);
      } catch (e) {
        if (movedOn(rec)) return getImages().length === 0;
        const tries = (readFailures.get(item.blob) ?? 0) + 1;
        console.warn(`vitrinka: blob journal read failed (${tries}/${READ_ATTEMPTS})`, e);
        if (tries < READ_ATTEMPTS) {
          readFailures.set(item.blob, tries);
          noteFailure(e);
          break; // transient — the bytes stay queued and journaled, the next flush retries
        }
      }
      if (movedOn(rec)) return getImages().length === 0;
    }
    if (!blob) {
      console.warn(`vitrinka: attachment seq ${item.seq} (${item.payload.name}) lost its bytes — its note lands without it`);
      clearStoredCaptures(item.sessionId, new Set([item.seq]));
      gone.add(item.seq);
      lost.push(item.blob);
      continue;
    }
    try {
      const up = await uploadImage(rec.sessionId, item.seq, blob);
      if (movedOn(rec)) return getImages().length === 0;
      pushRawEvent({
        seq: item.seq,
        ts: item.ts,
        tabId: item.tabId,
        tabHost: item.tabHost,
        kind: 'attachment',
        payload: { ...item.payload },
        blobKey: up.blobKey,
      });
      // The bytes stay journaled until the row is acknowledged (a helper tab may still need them).
      imageBlobs.delete(item.blob);
      rowBlobs.set(item.seq, item.blob);
      noteSync();
      gone.add(item.seq);
    } catch (e) {
      if (movedOn(rec)) return getImages().length === 0;
      if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
        console.warn(`vitrinka: attachment seq ${item.seq} rejected permanently (${e.status}) — dropped`);
        clearStoredCaptures(item.sessionId, new Set([item.seq]));
        gone.add(item.seq);
        lost.push(item.blob);
        continue;
      }
      noteFailure(e);
      console.warn('vitrinka: attachment upload failed', e);
      break; // transient — stop the pass, the next flush retries
    }
  }
  if (gone.size) {
    // The rows land in storage before the pending entries leave it.
    persistBuffer();
    setImages(getImages().filter((image) => !gone.has(image.seq)));
  }
  releaseImages(lost, true);
  return getImages().length === 0;
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
  recoverAllocations(true);
  if (pendingAllocations.size) await allocatePending();
  if (pendingAllocations.size) return false;
  const chunksClear = await drainPending();
  // A leaving page cannot finish an image upload; the blob journal keeps it for the next document.
  const imagesClear = opts.keepalive ? getImages().length === 0 : await drainImages();
  const pendingClear = chunksClear && imagesClear;
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
    if (batch.length >= EVENTS_PER_POST) break;
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
    clearStoredCaptures(rec.sessionId, oversized);
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
    if (movedOn(rec)) return false;
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
  // Acked for a session this tab no longer holds: the buffer is another
  // session's now, and its seqs restart — never filter it by these.
  if (movedOn(rec)) return true;
  noteSync();
  serverMaxSeq = Math.max(serverMaxSeq, ...batch.map((event) => event.seq));
  notify();
  // Remove EXACTLY the sent seqs — events pushed during the in-flight POST survive.
  const sent = new Set(batch.map((e) => e.seq));
  clearStoredCaptures(rec.sessionId, sent);
  const rest = getBuffer().filter((e) => !sent.has(e.seq));
  setBuffer(rest);
  // An acknowledged attachment row: its bytes are the server's now.
  for (const seq of sent) {
    const key = rowBlobs.get(seq);
    if (key === undefined) continue;
    rowBlobs.delete(seq);
    forgetBlob(key);
  }
  if (rest.length) scheduleFlush();
  return true;
}

/** Drain until buffer, chunks and images are empty or the deadline passes. */
export async function drainBuffer(deadlineMs = 60000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < deadlineMs) {
    // A peer may journal its departure after an already-running flush scanned storage.
    recoverAllocations(true);
    if (queuedCount() === 0) return true;
    const sent = await flush();
    if (getState()?.dead) return false;
    if (!sent) await new Promise<void>((res) => setTimeout(res, 1000));
  }
  console.warn('vitrinka: drain timed out — remaining events stay queued');
  return false;
}

/** Reset buffers for a fresh session. */
export function resetQueues(): void {
  for (const key of allocatedCaptures.keys()) kv().remove(key);
  for (const item of pendingAllocations) kv().remove(item.key);
  allocatedCaptures.clear();
  pendingAllocations.clear();
  allocationBytes = allocationChunks = 0;
  setBuffer([]);
  setChunks([]);
  // The journaled bytes go with pruneBlobJournal (the lifecycle knows which session ended).
  imageBlobs.clear();
  unjournaled.clear();
  rowBlobs.clear();
  readFailures.clear();
  setImages([]);
}

/**
 * Forget this tab's buffers WITHOUT writing storage: another tab owns the
 * stored record now, and its own tail there must survive.
 */
function dropLocalTail(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  bufferCache = [];
  chunkCache = [];
  chunkBytes = 0;
  imageCache = [];
  imageBlobs.clear();
  unjournaled.clear();
  rowBlobs.clear();
  pendingAllocations.clear();
  allocationBytes = allocationChunks = 0;
  allocatedCaptures.clear();
  tailDropped = true;
}

/** Test-only: drop all module state so suites cannot leak into each other. */
export function __resetForTests(): void {
  __dropCachesForTests();
  inFlightCaptures.clear();
  kv().remove('rec');
  kv().remove('buffer');
  kv().remove('chunks');
  kv().remove('images');
  kv().remove(BLOBS_KEY);
  kv().remove('seq');
  for (const key of kv().keys?.() ?? []) if (key.startsWith(ALLOCATION_PREFIX)) kv().remove(key);
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

/** Test-only: the images waiting for upload (in order), with their blob journal keys. */
export function __imagesForTests(): { seq: number; sessionId: string; blob: string; name: string }[] {
  return getImages().map((i) => ({ seq: i.seq, sessionId: i.sessionId, blob: i.blob, name: i.payload.name }));
}

/** Test-only: drop the in-memory caches while LEAVING storage intact (a reload). */
export function __dropCachesForTests(): void {
  pendingAllocations.clear();
  allocationBytes = allocationChunks = 0;
  allocatedCaptures.clear();
  allocationsRecovered = false;
  allocationBusy = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushBusy = false;
  tailDropped = false;
  stoppingHere = null;
  if (stoppingLease) clearInterval(stoppingLease);
  stoppingLease = null;
  recCache = undefined;
  bufferCache = undefined;
  chunkCache = undefined;
  chunkBytes = 0;
  // A reload keeps only what storage and the blob journal hold.
  imageCache = undefined;
  imageBlobs.clear();
  unjournaled.clear();
  rowBlobs.clear();
  readFailures.clear();
  disarmReconcile();
  lastSyncAt = 0;
  lastError = '';
  failures = 0;
  serverMaxSeq = -1;
}
