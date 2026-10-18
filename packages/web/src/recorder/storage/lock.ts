/** Cross-document exclusion for the shared localStorage driver's seq allocator. */
export async function withRecorderLock(name: string, run: () => void): Promise<void> {
  const key = `vitrinka.recorder.${name}`;
  if (globalThis.navigator?.locks) {
    await navigator.locks.request(key, { signal: AbortSignal.timeout(5000) }, run);
    return;
  }
  const fence = { area: localArea(), key: `vitrinka.recorder.lock.${name}` };
  // Web Locks requires a secure context. IndexedDB readwrite transactions
  // also serialize across tabs, including ordinary HTTP development hosts.
  const db = await lockDatabase();
  const deadline = Date.now() + HAND_OVER_MS;
  while (!(await holdOnce(db, key, fence, run, Date.now() >= deadline))) await pause();
}

/** The calling document's localStorage, and where the lock's fence lives in it. */
interface Fence { area: Storage | null; key: string }

/** A fence this tab never hears (its storage cleared, a write lost) holds it back this long; then it runs anyway. */
const HAND_OVER_MS = 1000;
const HEAR_POLL_MS = 5;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, HEAR_POLL_MS));

function localArea(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // refused (a sandboxed frame): exclusion alone
  }
}

/** Has this document's localStorage heard the last holder's fence (none yet: nothing to hear)? */
function heard(fence: Fence, last: unknown): boolean {
  return typeof last !== 'string' || !fence.area || fence.area.getItem(fence.key) === last;
}

/** A new fence, written after this holder's own writes; null when the store refused it. */
function publishFence(fence: Fence): string | null {
  if (!fence.area) return null;
  const next = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}`;
  try {
    fence.area.setItem(fence.key, next);
    return next;
  } catch (error) {
    console.warn('vitrinka: recorder lock fence not stored — the next tab may not see this allocation', error);
    return null;
  }
}

let unheardWarned = false;
function warnUnheard(): void {
  if (unheardWarned) return;
  unheardWarned = true;
  console.warn(`vitrinka: this tab did not hear the last recorder lock holder within ${HAND_OVER_MS} ms — numbering anyway`);
}

/**
 * One IndexedDB hold. A readwrite transaction excludes the other tabs but
 * does not show them the holder's localStorage writes: Chromium keeps a copy
 * of localStorage per renderer and delivers another tab's writes to it
 * later, unordered with the transaction hand-over, so the next holder could
 * read the seq watermark from before the last allocation and number a
 * capture twice. Each holder therefore leaves a fresh fence in localStorage,
 * after its own writes (they reach every tab in order), and in this
 * transaction's record, which every tab reads coherently. A tab whose
 * localStorage does not show the record's fence yet lets go and retries
 * (the transaction would commit across a timer); `late` runs it regardless.
 */
function holdOnce(db: IDBDatabase, key: string, fence: Fence, run: () => void, late: boolean): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction('locks', 'readwrite');
    const store = tx.objectStore('locks');
    let ran = false;
    tx.oncomplete = () => resolve(ran);
    tx.onabort = () => reject(tx.error ?? new Error('vitrinka: recorder lock transaction aborted'));
    const request = store.get(key);
    request.onsuccess = () => {
      if (!heard(fence, request.result)) {
        if (!late) return;
        warnUnheard();
      }
      try {
        run();
      } catch (error) {
        reject(error);
        tx.abort();
        return;
      }
      ran = true;
      const next = publishFence(fence);
      if (next) store.put(next, key);
    };
  });
}

let database: Promise<IDBDatabase> | undefined;

function lockDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vitrinka.recorder.locks', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('locks');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
    }).catch((error: unknown) => {
      database = undefined;
      throw error;
    });
  }
  return database;
}
