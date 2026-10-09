/**
 * Pluggable durable KV storage for the recorder's queue and session state.
 *
 * Reads/writes are synchronous for queue bookkeeping within one document.
 * A driver shared across documents must also serialize seq allocations:
 * one JS tick in one tab does not exclude a second tab's read-modify-write.
 *
 * When `localStorage` is unavailable or throws on first touch (Safari private
 * mode, a sandboxed iframe, a storage-disabled profile) the recorder falls
 * back to the in-memory driver: capture still works for the life of the
 * document, only the reload-survival guarantee is lost — and it says so once.
 */
import { withRecorderLock } from './lock';

export interface RecorderStorage {
  /** Read a value; null/undefined when the key was never written. */
  getString(key: string): string | null | undefined;
  /** Write a value durably before returning. */
  set(key: string, value: string): void;
  /** Delete a key; a no-op when absent. */
  remove(key: string): void;
  /**
   * Hear another document (a second tab) write `key` — `null` when it was
   * removed; returns the unsubscribe. Optional: a driver no other document
   * shares (memory) has nothing to hear.
   */
  watch?(key: string, onChange: (value: string | null) => void): () => void;
  /** Run synchronously inside an exclusive cross-document lock. Required when shared across tabs. */
  withLock?(name: string, run: () => void): Promise<void>;
  /** Enumerate this driver's namespaced keys (cross-tab Stop participants). */
  keys?(): string[];
}

// Keys land as `vitrinka.recorder.<key>`: rec · buffer · chunks · images ·
// blobs · link (the recorder) and dock · prefs · me · recents (the HUD). An
// attached image's bytes live in the blob journal (./blobs, IndexedDB).
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
      withLock: withRecorderLock,
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i))
        .filter((key): key is string => key !== null && key.startsWith(PREFIX))
        .map((key) => key.slice(PREFIX.length)),
      // localStorage is shared by every tab of the origin; its `storage`
      // event reaches the OTHER documents only. A clear() (key null) is not
      // a write of `k` and is ignored.
      watch: (k, onChange) => {
        const on = (e: StorageEvent) => {
          if (e.storageArea === ls && e.key === PREFIX + k) onChange(e.newValue);
        };
        globalThis.addEventListener('storage', on);
        return () => globalThis.removeEventListener('storage', on);
      },
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
    keys: () => [...m.keys()],
  };
}

/** Test-only: forget the configured driver and the first-use latch. */
export function __resetStorageForTests(): void {
  current = null;
  used = false;
}
