// Vitrinka Journey Recorder — durable capture queue (recorder-live D7/D8).
//
// The event log used to be ONE array in chrome.storage.local, rewritten in
// full on every push (`storage.local.set({buffer})`). With up to 64 KiB of
// request body + 64 KiB of response body per network event, recording a
// session meant re-serializing megabytes per click — O(n²) disk for a linear
// recording, and the reason a long session got progressively laggier.
//
// IndexedDB is the right engine for an append-heavy log: per-record writes, a
// cursor to read the head, and NATIVE Blob storage — queued screenshots stop
// paying the ~33% tax of being held as base64 dataURL strings.
//
// D8 — nothing is ever dropped. `unlimitedStorage` is granted and this is a
// debugging tool: an outage grows the queue and the HUD turns loud (D4). The
// old MAX_BUFFER / PENDING_CAP_BYTES eviction silently spliced away the START
// of a journey with only a console.warn nobody had open. Storage is bounded
// instead by reaping DEAD sessions (D9), never live ones.
//
// The key is the COMPOUND [sessionId, seq], not seq alone: `seq` restarts at 1
// for every session, so a global key let a new session's first capture
// silently overwrite an earlier session's queued item (review r3650505022).
// The compound key also gives every per-session operation a plain key range —
// the head cursor, usage stats and reaping all scope by it, and no secondary
// index is needed.
//
//   {sessionId, seq, ts, tabId, tabHost, kind, payload,
//    blob?      Blob      — shot PNG / rrweb JSON awaiting upload
//    blobCT?    string    — its content type
//    blobKey?   string    — set once the blob is uploaded; blob is then dropped
//    bytes      number    — payload+blob size, so usage stats never read blobs
//    needsBlob  0|1       — 1 while a blob upload is still owed}

const DB_NAME = "vitrinka-recorder";
// v2 re-keyed the store to [sessionId, seq]; a keyPath cannot be altered in
// place, so the upgrade drops and recreates. Only a pre-release build of this
// same PR can hold a v1 store — nothing shipped on v1.
const DB_VERSION = 2;
const STORE = "queue";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: ["sessionId", "seq"] });
    };
    req.onsuccess = () => {
      // A version change from another context (options page upgrading) must
      // not leave this handle wedged open and block it.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// wrap turns one IDBRequest into a promise. Every store call goes through it,
// so an IDB error surfaces as a rejection instead of an unhandled event.
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// sessionRange is every record belonging to one session, in seq order.
function sessionRange(sessionId) {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
}

function sizeOf(item) {
  let n = 0;
  if (item.payload !== undefined) {
    try { n += new Blob([JSON.stringify(item.payload)]).size; } catch { n += 0; }
  }
  if (item.blob) n += item.blob.size;
  return n;
}

export const vtdb = {
  // put writes one captured item. Capture calls this and returns — it never
  // waits on the network (D6); the uploader drains from here.
  async put(item) {
    if (!item.sessionId || !item.seq) throw new Error("vtdb.put: sessionId and seq are required");
    const db = await openDB();
    const rec = { ...item, bytes: sizeOf(item), needsBlob: item.blob ? 1 : 0 };
    await wrap(tx(db, "readwrite").put(rec));
    return rec;
  },

  // head returns THIS session's oldest `limit` items in seq order — the
  // uploader's FIFO. Scoped on purpose: an older session's undelivered tail
  // must never starve the live one out of its own upload budget.
  async head(sessionId, limit = 200) {
    const db = await openDB();
    const out = [];
    await new Promise((resolve, reject) => {
      const req = tx(db, "readonly").openCursor(sessionRange(sessionId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  },

  // resolveBlob records a completed blob upload and releases the bytes: the
  // blobKey is all the event row needs from here on.
  async resolveBlob(sessionId, seq, blobKey) {
    const db = await openDB();
    const item = await wrap(tx(db, "readonly").get([sessionId, seq]));
    if (!item) return null;
    const next = { ...item, blobKey, needsBlob: 0 };
    delete next.blob;
    next.bytes = sizeOf(next);
    await wrap(tx(db, "readwrite").put(next));
    return next;
  },

  async remove(sessionId, seqs) {
    if (!seqs.length) return;
    const db = await openDB();
    const store = tx(db, "readwrite");
    await Promise.all(seqs.map((seq) => wrap(store.delete([sessionId, seq]))));
  },

  // stats powers the HUD's health line and the options page usage rows.
  async stats() {
    const db = await openDB();
    const out = { count: 0, bytes: 0, blobs: 0, oldestTs: null, bySession: {} };
    await new Promise((resolve, reject) => {
      const req = tx(db, "readonly").openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const v = cur.value;
        out.count++;
        out.bytes += v.bytes || 0;
        if (v.needsBlob) out.blobs++;
        if (!out.oldestTs || v.ts < out.oldestTs) out.oldestTs = v.ts;
        const s = out.bySession[v.sessionId] ||
          (out.bySession[v.sessionId] = { count: 0, bytes: 0, blobs: 0 });
        s.count++;
        s.bytes += v.bytes || 0;
        if (v.needsBlob) s.blobs++;
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  },

  // sessionStats is stats() for ONE session, cursoring only that session's key
  // range. The drain loop polls this every iteration, and a whole-store cursor
  // there would walk every other session's records to throw them away
  // (review r3650595589).
  async sessionStats(sessionId) {
    const db = await openDB();
    const out = { count: 0, bytes: 0, blobs: 0, maxSeq: 0 };
    await new Promise((resolve, reject) => {
      const req = tx(db, "readonly").openCursor(sessionRange(sessionId));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        out.count++;
        out.maxSeq = Math.max(out.maxSeq, cur.value.seq);
        out.bytes += cur.value.bytes || 0;
        if (cur.value.needsBlob) out.blobs++;
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  },

  // dropSession removes everything belonging to one session — the D9 reaper's
  // only destructive act, and it only ever runs on a session the SERVER has
  // already declared done, deleted or gone.
  async dropSession(sessionId) {
    const db = await openDB();
    const store = tx(db, "readwrite");
    const n = await wrap(store.count(sessionRange(sessionId)));
    await wrap(tx(db, "readwrite").delete(sessionRange(sessionId)));
    return n;
  },

  async clear() {
    const db = await openDB();
    await wrap(tx(db, "readwrite").clear());
  },
};
