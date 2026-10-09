/**
 * The blob journal (recorder attachments D4): the bytes of an attached image
 * waiting for upload, kept in IndexedDB so a queued image survives a tab
 * reload the way the KV store's event tail does — the KV store (localStorage,
 * a few MiB) cannot hold image bytes. Keys are `<sessionId>/<document>.<n>`;
 * the queue writes one before the image's event is journaled, reads it back
 * to upload after a reload, and deletes it once the server acknowledged the
 * image's event. Shared by every tab of the origin, like the KV store.
 *
 * Where IndexedDB is absent the journal is memory; where it refuses to open
 * or write (a storage-disabled profile, some private modes, the quota) its
 * calls reject and the queue keeps the bytes in memory. Either way the image
 * still uploads from this document, only the reload guarantee is lost — and
 * the recorder says so.
 */
export interface RecorderBlobStore {
  /** Survives a reload (false for the memory fallback). */
  readonly durable: boolean;
  put(key: string, blob: Blob): Promise<void>;
  /** null when the key was never written or is gone. */
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

const DB = 'vitrinka.recorder.blobs';
const STORE = 'blobs';

let current: RecorderBlobStore | null = null;

/** The active journal; lazily IndexedDB, else memory. */
export function getRecorderBlobStore(): RecorderBlobStore {
  if (!current) current = typeof indexedDB === 'undefined' ? memoryBlobStore() : indexedDbBlobStore();
  return current;
}

/** Install a journal (tests; a host with its own store). */
export function configureRecorderBlobStore(store: RecorderBlobStore): void {
  current = store;
}

/** In-memory journal — tests, and the non-durable fallback. */
export function memoryBlobStore(): RecorderBlobStore {
  const m = new Map<string, Blob>();
  return {
    durable: false,
    put: async (k, b) => void m.set(k, b),
    get: async (k) => m.get(k) ?? null,
    delete: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  };
}

function indexedDbBlobStore(): RecorderBlobStore {
  let db: Promise<IDBDatabase> | undefined;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error ?? new Error('vitrinka: blob journal did not open'));
      request.onsuccess = () => {
        const opened = request.result;
        opened.onversionchange = () => {
          opened.close();
          db = undefined;
        };
        // Closed by the browser (site data cleared, a lost IndexedDB server): the next call reopens.
        opened.onclose = () => {
          db = undefined;
        };
        resolve(opened);
      };
    }).catch((error: unknown) => {
      db = undefined;
      throw error;
    });
    return db;
  };
  const run = async <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const conn = open();
    let tx: IDBTransaction;
    try {
      tx = (await conn).transaction(STORE, mode);
    } catch (error) {
      // A connection that closed without a close event (Safari) refuses every transaction: reopen next time.
      if (db === conn) db = undefined;
      throw error;
    }
    const request = op(tx.objectStore(STORE));
    return new Promise<T>((resolve, reject) => {
      // A write counts once its transaction commits, not when the request succeeds.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error ?? new Error('vitrinka: blob journal transaction failed'));
    });
  };
  return {
    durable: true,
    put: async (k, b) => void (await run('readwrite', (s) => s.put(b, k))),
    get: async (k) => {
      const v: unknown = await run('readonly', (s) => s.get(k));
      return v instanceof Blob ? v : null;
    },
    delete: async (k) => void (await run('readwrite', (s) => s.delete(k))),
    keys: async () => (await run('readonly', (s) => s.getAllKeys())).filter((k): k is string => typeof k === 'string'),
  };
}

/** Test-only: forget the installed journal. */
export function __resetBlobStoreForTests(): void {
  current = null;
}
