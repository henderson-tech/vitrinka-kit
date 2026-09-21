/**
 * Pluggable durable KV storage for the recorder's queue and session state.
 *
 * The queue's correctness leans on SYNCHRONOUS reads/writes: every
 * read-modify-write completes in one JS tick, so no async mutex is needed and
 * delivery-ack bookkeeping stays race-free. Any driver plugged in here MUST be
 * synchronous — which is why the default is `localStorage` and not IndexedDB.
 *
 * When `localStorage` is unavailable or throws on first touch (Safari private
 * mode, a sandboxed iframe, a storage-disabled profile) the recorder falls
 * back to the in-memory driver: capture still works for the life of the
 * document, only the reload-survival guarantee is lost — and it says so once.
 */

export interface RecorderStorage {
  /** Read a value; null/undefined when the key was never written. */
  getString(key: string): string | null | undefined;
  /** Write a value durably before returning. */
  set(key: string, value: string): void;
  /** Delete a key; a no-op when absent. */
  remove(key: string): void;
}

// Keys land as `vitrinka.recorder.<key>`: rec · buffer · chunks · link.
const PREFIX = 'vitrinka.recorder.';

let current: RecorderStorage | null = null;
let used = false;

/**
 * Install a storage driver. Call before the recorder mounts; calling after
 * first use throws — silently switching stores mid-session would strand the
 * durable tail in the old one.
 */
export function configureRecorderStorage(driver: RecorderStorage): void {
  if (used && current !== driver) {
    throw new Error(
      'vitrinka: configureRecorderStorage() must run before the recorder first touches storage',
    );
  }
  current = driver;
}

/** The active driver; lazily falls back to localStorage, then memory. */
export function getRecorderStorage(): RecorderStorage {
  if (!current) current = localRecorderStorage() ?? memoryRecorderStorage();
  used = true;
  return current;
}

/** `localStorage` driver, or null when the API is absent or refuses a write. */
export function localRecorderStorage(): RecorderStorage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const probe = `${PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getString: (k) => ls.getItem(PREFIX + k),
      set: (k, v) => ls.setItem(PREFIX + k, v),
      remove: (k) => ls.removeItem(PREFIX + k),
    };
  } catch {
    console.warn('vitrinka: localStorage unavailable — the recorder queue will not survive a reload');
    return null;
  }
}

/** In-memory driver — for tests and as the last-resort non-durable fallback. */
export function memoryRecorderStorage(): RecorderStorage {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

/** Test-only: forget the configured driver and the first-use latch. */
export function __resetStorageForTests(): void {
  current = null;
  used = false;
}
