/**
 * The capture store (QA Studio D7, capture profile `storage: browser`): the
 * flight buffer's windows in IndexedDB, so the minutes before a report
 * survive the page loads a multi-page app makes along the way. One database
 * per origin, `vitrinka.capture`:
 *
 *   windows  {id, tab, scope, kind?, load, startMs, lastMs, count, bytes, href, route}   key id
 *   chunks   {events: <JSON array of rrweb events>, lanes: [...]}                       key [windowId, part]
 *
 * A `windows` row is an rrweb window (its chunks carry events) or, with
 * `kind: 'lanes'`, a span of console and network entries (its chunks carry
 * lanes) — stored whether or not the profile records a replay.
 *
 * What lands here is already masked: rrweb masks the DOM at emit, the Meta
 * URL is scrubbed and every lane event redacted before the buffer holds it
 * (flight.ts). A window leaves with its window (flight `windowEnd`), every
 * window of a tab after that tab's report is sent (`clear`), and anything
 * past its age on the next load of any tab (`sweep`). Typed drafts never
 * come near it.
 */
import type { eventWithTime } from '@rrweb/types';

import { type FlightLaneEvent, type FlightStore, type StoredWindow, windowEnd } from '../flight';

const DB = 'vitrinka.capture';
const WINDOWS = 'windows';
const CHUNKS = 'chunks';

interface ChunkRecord {
  events: string;
  lanes: FlightLaneEvent[];
}

export interface CaptureStore extends FlightStore {
  /**
   * The next load's cleanup: drop every window (any tab) whose `windowEnd`
   * is older than `windowMs`, and this tab's windows captured under another
   * `scope` (another project, a laxer masking, wider classes) — fail closed;
   * return this tab's survivors oldest first.
   */
  sweep(now: number, windowMs: number, tab: string, scope: string): Promise<StoredWindow[]>;
  /** A stored window's events and lane events, in capture order. */
  read(windowId: string): Promise<{ events: eventWithTime[]; lanes: FlightLaneEvent[] }>;
  close(): void;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('vitrinka: capture store transaction failed'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('vitrinka: capture store request failed'));
  });
}

function chunkRange(windowId: string): IDBKeyRange {
  return IDBKeyRange.bound([windowId, 0], [windowId, Number.MAX_SAFE_INTEGER]);
}

function isStoredWindow(v: unknown): v is StoredWindow {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  // A record without a scope cannot say what it was captured for: it never comes back (sweep).
  return typeof w.id === 'string' && typeof w.tab === 'string' && typeof w.startMs === 'number' && typeof w.lastMs === 'number';
}

/** Open (creating) the store; rejects where IndexedDB is absent or refuses — the caller stays in memory. */
export function openCaptureStore(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<CaptureStore> {
  if (!idb) return Promise.reject(new Error('vitrinka: IndexedDB is not available'));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = idb.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WINDOWS, { keyPath: 'id' });
      request.result.createObjectStore(CHUNKS);
    };
    request.onerror = () => reject(request.error ?? new Error('vitrinka: capture store did not open'));
    request.onblocked = () => reject(new Error('vitrinka: capture store is blocked by another tab'));
    request.onsuccess = () => resolve(request.result);
  }).then((db) => {
    db.onversionchange = () => db.close();
    const dropIn = (tx: IDBTransaction, windowId: string) => {
      tx.objectStore(WINDOWS).delete(windowId);
      tx.objectStore(CHUNKS).delete(chunkRange(windowId));
    };
    const store: CaptureStore = {
      async putWindow(w) {
        const tx = db.transaction(WINDOWS, 'readwrite');
        tx.objectStore(WINDOWS).put(w);
        await done(tx);
      },
      async putChunk(windowId, part, events, lanes) {
        const tx = db.transaction(CHUNKS, 'readwrite');
        const record: ChunkRecord = { events, lanes: [...lanes] };
        tx.objectStore(CHUNKS).put(record, [windowId, part]);
        await done(tx);
      },
      async putWindowChunk(head, part, events, lanes) {
        const tx = db.transaction([WINDOWS, CHUNKS], 'readwrite');
        const record: ChunkRecord = { events, lanes: [...lanes] };
        try {
          tx.objectStore(CHUNKS).put(record, [head.id, part]);
          tx.objectStore(WINDOWS).put(head);
        } catch (e) {
          tx.abort();
          throw e;
        }
        await done(tx);
      },
      async dropWindow(windowId) {
        const tx = db.transaction([WINDOWS, CHUNKS], 'readwrite');
        dropIn(tx, windowId);
        await done(tx);
      },
      async clear(tab) {
        const tx = db.transaction([WINDOWS, CHUNKS], 'readwrite');
        const all = await result(tx.objectStore(WINDOWS).getAll());
        for (const w of all) if (isStoredWindow(w) && w.tab === tab) dropIn(tx, w.id);
        await done(tx);
      },
      async sweep(now, windowMs, tab, scope) {
        const tx = db.transaction([WINDOWS, CHUNKS], 'readwrite');
        const all = (await result(tx.objectStore(WINDOWS).getAll())).filter(isStoredWindow);
        const kept: StoredWindow[] = [];
        const byTab = new Map<string, StoredWindow[]>();
        for (const w of all) byTab.set(w.tab, [...(byTab.get(w.tab) ?? []), w]);
        for (const [owner, list] of byTab) {
          // A replay window lasts until the next replay window of its load; a
          // lane span until its newest entry.
          const replay = list.filter((w) => w.kind !== 'lanes').sort((a, b) => a.startMs - b.startMs);
          const end = (w: StoredWindow) => (w.kind === 'lanes' ? w.lastMs : windowEnd(w, replay[replay.indexOf(w) + 1]));
          for (const w of list.sort((a, b) => a.startMs - b.startMs)) {
            const aged = end(w) <= now - windowMs;
            if (aged || (owner === tab && w.scope !== scope)) dropIn(tx, w.id);
            else if (owner === tab) kept.push(w);
          }
        }
        await done(tx);
        return kept;
      },
      async read(windowId) {
        const tx = db.transaction(CHUNKS, 'readonly');
        const records = await result(tx.objectStore(CHUNKS).getAll(chunkRange(windowId)));
        await done(tx);
        const events: eventWithTime[] = [];
        const lanes: FlightLaneEvent[] = [];
        for (const r of records as ChunkRecord[]) {
          // boundary: our own JSON, written by putChunk above.
          events.push(...(JSON.parse(r.events) as eventWithTime[]));
          lanes.push(...r.lanes);
        }
        return { events, lanes };
      },
      close: () => db.close(),
    };
    return store;
  });
}

/**
 * Leave nothing on disk where the profile says memory (a host narrowed it,
 * the project changed it): delete the database if a browser profile left one.
 */
export function deleteCaptureStore(idb: IDBFactory | undefined = globalThis.indexedDB): void {
  try {
    idb?.deleteDatabase(DB);
  } catch (e) {
    console.warn('vitrinka: could not delete the capture store', e);
  }
}
