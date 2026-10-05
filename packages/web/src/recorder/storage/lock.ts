/** Cross-document exclusion for the shared localStorage driver's seq allocator. */
export async function withRecorderLock(name: string, run: () => void): Promise<void> {
  const key = `vitrinka.recorder.${name}`;
  if (globalThis.navigator?.locks) {
    await navigator.locks.request(key, { signal: AbortSignal.timeout(5000) }, run);
    return;
  }
  // Web Locks requires a secure context. IndexedDB readwrite transactions
  // also serialize across tabs, including ordinary HTTP development hosts.
  const db = await lockDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('locks', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('vitrinka: recorder lock transaction aborted'));
    const request = tx.objectStore('locks').get(key);
    request.onsuccess = () => {
      try {
        run();
      } catch (error) {
        reject(error);
        tx.abort();
      }
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
