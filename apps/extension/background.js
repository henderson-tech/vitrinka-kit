// Vitrinka Journey Recorder — background service worker.
//
// Decisions: journey recorder 2026-07-24 (D1 session event stream, D2
// chrome.debugger CDP network capture with graceful degrade, D3 rrweb chunks
// recorded now + rendered later, D7 capture-everything: bodies are kept up to
// BODY_CAP because recording is opt-in per session and the tester chooses what
// to record; nothing leaves the machine except to the configured vitrinka host)
// and recorder-live 2026-07-25 (D2 Stop shows real drain progress, D4/D5 an
// honest health signal reconciled against the server, D6 one upload pipeline,
// D7 IndexedDB queue, D8 never drop, D9 reap only DEAD sessions, D11 poll for
// board readiness because a worker has no EventSource).
//
// MV3 service workers die after ~30s idle, so nothing lives only in memory:
// the small hot state (config, `rec`) is chrome.storage.local, and everything
// captured goes to the IndexedDB queue in db.js. Capture writes and RETURNS;
// one uploader drains the queue FIFO. Every entry point rehydrates first.

import { vtdb } from "./db.js";
import { newerVersion } from "./version.js";

const FLUSH_MS = 2000;
const SHOT_THROTTLE_MS = 700;
const BODY_CAP = 64 * 1024;
// The server caps one events POST at 500.
const UPLOAD_BATCH = 500;
// How long Stop keeps trying before it hands the tester an honest error. The
// queue is never discarded on timeout — a later Stop finishes the job.
const STOP_DRAIN_MS = 60_000;
// Health thresholds (D4): quiet until one of these trips.
const OFFLINE_AFTER_MS = 15_000;
const BACKLOG_ITEMS = 40;
// How often a live session reconciles its seq against the server's maxSeq.
const RECONCILE_MS = 10_000;
// Board-readiness poll cadence + ceiling (D11).
const READY_POLL_MS = 1_500;
const READY_GIVE_UP_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// config + state

async function getConfig() {
  // captureWorkers gates Target.setAutoAttach (worker/SW network capture).
  // Default ON; automation harnesses (Playwright) must set it to false — an
  // extension-issued setAutoAttach collides with the harness's own CDP
  // auto-attach and takes the whole browser down.
  // stopDrainMs overrides how long Stop keeps retrying before it gives up and
  // reports the queue as kept-on-disk. Only the PATIENCE is configurable — the
  // refuse-and-keep behaviour is identical either way — so the e2e outage spec
  // shortens it to reach the same refusal in seconds instead of a full minute.
  // captureNetwork gates the whole CDP attach (tab network + page console).
  // Default ON; test harnesses that seed synthetic request events set it to
  // false — a main-tab chrome.debugger.attach succeeds NONDETERMINISTICALLY
  // under Playwright (its own CDP session usually wins), so organic page
  // traffic would otherwise leak into a spec's waterfall only on slow runs.
  const { base = "", token = "", captureWorkers = true, captureNetwork = true, stopDrainMs = STOP_DRAIN_MS } =
    await chrome.storage.local.get(["base", "token", "captureWorkers", "captureNetwork", "stopDrainMs"]);
  return { base: base.replace(/\/$/, ""), token, captureWorkers, captureNetwork, stopDrainMs };
}

async function getState() {
  const { rec = null } = await chrome.storage.local.get("rec");
  return rec;
}
async function setState(rec) {
  await chrome.storage.local.set({ rec });
}

// capturing gates every NEW capture. `stopping` is deliberately separate from
// `paused`: Stop must freeze clicks/navs/shots immediately while still
// accepting each content script's final rrweb batch (detachAll awaits it).
function capturing(rec) {
  return !!rec && !rec.paused && !rec.stopping && !rec.dead;
}

// One async mutex serializes every read-modify-write of rec. The SW is
// single-threaded, but interleaved awaits let two producers read the same seq
// or clobber each other's writes (review #3644465006/#3644464994).
let _chain = Promise.resolve();
function withLock(fn) {
  const run = _chain.then(fn, fn);
  _chain = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// HTTP status from an api() error — 0 when the failure never got a response.
function statusOf(e) {
  return Number((String(e && e.message).match(/→ (\d{3}):/) || [])[1] || 0);
}

// A server verdict that retrying can never fix (4xx minus timeout/rate-limit).
function permanentStatus(st) {
  return st >= 400 && st < 500 && st !== 408 && st !== 429;
}

async function api(method, path, body, contentType) {
  const { base, token } = await getConfig();
  if (!base) throw new Error("vitrinka base URL not configured (options page)");
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = contentType || "application/json";
  const res = await fetch(base + path, {
    method, headers,
    body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// rrweb chunk splitting
//
// Serialized-size split for rrweb batches: with inlineImages/collectFonts on,
// a single 2s batch (especially the full snapshot) can blow past the server's
// 12 MiB chunk cap — and an oversized chunk can NEVER upload, so admitting it
// would poison the queue. Greedy-pack events into in-order parts under a pack
// margin; an event too big to PACK (the inflated full snapshot) rides ALONE in
// its own part up to the wire cap. Only an event that alone exceeds the wire
// cap is undeliverable — it is reported in `dropped` and the caller surfaces
// it on the session timeline, because a dropped snapshot can make the rest of
// the recording unreplayable. packBytes/hardBytes are parameters only for
// deterministic tests.
const WIRE_ITEM_CAP = 12 * 1024 * 1024;
const CHUNK_PACK_BYTES = 10 * 1024 * 1024;
const CHUNK_HARD_BYTES = WIRE_ITEM_CAP - 64; // "[" + "]" + headroom

// Returns {parts, bodies, dropped}: bodies[i] is parts[i] ALREADY serialized
// — the caller uploads bodies verbatim. ONE serialization pass total.
function splitRRWebEvents(events, packBytes = CHUNK_PACK_BYTES, hardBytes = CHUNK_HARD_BYTES) {
  const enc = new TextEncoder();
  const parts = [], bodies = [], dropped = [];
  let cur = [], curStrs = [], curBytes = 2; // "[]"
  const flushPart = () => {
    if (!cur.length) return;
    parts.push(cur);
    bodies.push("[" + curStrs.join(",") + "]");
    cur = []; curStrs = []; curBytes = 2;
  };
  for (const ev of events) {
    const s = JSON.stringify(ev);
    const b = enc.encode(s).length + 1; // +1 for the comma
    if (b > hardBytes) { dropped.push(b); continue; }
    if (b > packBytes) {
      // Bigger than the pack margin but deliverable — its own single-event part.
      flushPart();
      parts.push([ev]);
      bodies.push("[" + s + "]");
      continue;
    }
    if (cur.length && curBytes + b > packBytes) flushPart();
    cur.push(ev);
    curStrs.push(s);
    curBytes += b;
  }
  flushPart();
  return { parts, bodies, dropped };
}

// ---------------------------------------------------------------------------
// health (D4/D5)
//
// Honest by construction. Queue depth and last-successful-sync age come from
// this worker; `serverMaxSeq` comes from the session detail the reconcile poll
// already fetches, so the HUD can say "the server has everything I sent"
// rather than merely "my last POST returned 200". That same poll is what
// notices the session being closed or deleted underneath the recorder — the
// condition that used to wedge the flush in a 2s forever-retry.

let lastSyncAt = 0;
let lastError = "";
let failures = 0;
let serverMaxSeq = -1;
let wrapping = null; // {total, left} while Stop drains

function noteSync() {
  lastSyncAt = Date.now();
  failures = 0;
  lastError = "";
}
function noteFailure(e) {
  failures++;
  lastError = String((e && e.message) || e).slice(0, 200);
}

async function health() {
  const rec = await getState();
  // The HUD speaks about THIS recording: an older session's undelivered tail
  // is real (D8 keeps it) but it is not what the tester is doing right now,
  // and counting it would make a healthy session look backlogged. Scoped to
  // the session's key range so a big queue elsewhere costs nothing here.
  const st = await (rec ? vtdb.sessionStats(rec.sessionId) : vtdb.stats())
    .catch(() => ({ count: 0, bytes: 0, blobs: 0 }));
  const sinceSync = lastSyncAt ? Date.now() - lastSyncAt : null;
  let state = "idle";
  if (rec) {
    if (rec.dead) state = "dead";
    else if (rec.stopping) state = "wrapping";
    else if (failures >= 2 || (st.count > 0 && sinceSync !== null && sinceSync > OFFLINE_AFTER_MS)) state = "offline";
    else if (st.count > BACKLOG_ITEMS) state = "backlog";
    else state = "ok";
  }
  return {
    state,
    queued: st.count,
    bytes: st.bytes,
    blobs: st.blobs,
    sinceSyncMs: sinceSync,
    failures,
    error: lastError,
    sessionId: rec ? rec.sessionId : null,
    localSeq: rec ? rec.seq : 0,
    serverMaxSeq,
    // synced is the reconciliation itself: everything this recorder allocated
    // is accounted for on the server.
    synced: !!rec && serverMaxSeq >= 0 && serverMaxSeq >= (rec.seq || 0) && st.count === 0,
    deadReason: rec && rec.dead ? rec.deadReason : "",
    wrapping,
    elapsedMs: elapsedOf(rec),
  };
}

// broadcastHealth mirrors the state into every recorded tab's HUD. The popup
// pulls the same object on demand (vt-status) — it is the detail surface (D4).
async function broadcastHealth() {
  const rec = await getState();
  if (!rec) return;
  const h = await health();
  for (const tabId of Object.keys(rec.tabs || {})) {
    chrome.tabs.sendMessage(Number(tabId), { type: "vt-health", health: h }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// capture queue + the single upload pipeline (D6/D7/D8)
//
// There is exactly ONE upload path now. Before recorder-live the happy path
// POSTed inline from shoot()/vt-rrweb and only FAILURES fell back to a retry
// queue: a burst of clicks serialized behind each other on the worker's single
// thread, and the two paths could disagree about ordering.
//
// Durability over latency: an item is written to IndexedDB BEFORE any upload
// is attempted. An MV3 worker can be killed at any instant with no usable
// shutdown hook, so an in-memory-first queue would trade D8's never-drop
// promise for a few milliseconds.

// enqueue writes one captured item. The caller passes the sessionId it
// ALLOCATED its seq under (see allocSeq) — re-reading the live session here
// would stamp a stop/start that landed during the caller's awaits, filing the
// old session's seq under the new session (review r3650505024).
async function enqueue(item) {
  await vtdb.put(item);
  scheduleFlush();
}

// pushEvents allocates seqs and queues plain (blob-less) events.
async function pushEvents(items) {
  const rec = await withLock(async () => {
    const cur = await getState();
    if (!capturing(cur)) return null;
    cur.seq += items.length;
    await setState(cur);
    return cur;
  });
  if (!rec) return;
  const first = rec.seq - items.length + 1;
  for (let i = 0; i < items.length; i++) {
    await vtdb.put({
      sessionId: rec.sessionId, seq: first + i, ts: new Date().toISOString(), ...items[i],
    });
  }
  scheduleFlush();
}

// Allocate `count` consecutive seqs without emitting events (blob uploads name
// their blobs by seq). Returns {seq, sessionId} — the pair, atomically: a seq
// only means anything alongside the session it was drawn from, and a caller
// that awaits between allocating and writing (shoot() encodes a PNG in that
// gap) must not have its item re-attributed to a session that started
// meanwhile. Multi-part rrweb batches reserve their whole range in this one
// lock, so a concurrent handler can never interleave into it.
function allocSeq(count = 1) {
  return withLock(async () => {
    const rec = await getState();
    if (!rec) return null;
    const first = rec.seq + 1;
    rec.seq += count;
    await setState(rec);
    return { seq: first, sessionId: rec.sessionId };
  });
}

let flushTimer = null;
function scheduleFlush(delay = FLUSH_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay);
}

let flushBusy = false;
// flush drains what it can and reports whether the queue is now empty.
// Single-flight: Stop's drain loop and the scheduled timer must never overlap
// or they would double-POST the same head.
async function flush() {
  if (flushBusy) return false;
  flushBusy = true;
  try {
    return await flushInner();
  } catch (e) {
    // An IndexedDB failure is not something to swallow — without the queue
    // the recorder has no memory at all.
    console.error("vitrinka: flush aborted", e);
    noteFailure(e);
    return false;
  } finally {
    flushBusy = false;
    broadcastHealth();
  }
}

async function flushInner() {
  const rec = await getState();
  if (!rec || rec.dead) {
    // Nothing to upload INTO. The queue is not discarded — the D9 reaper asks
    // the server what became of each session and clears only what is dead.
    return false;
  }
  // Scoped to THIS session's key range: an older session's undelivered tail
  // stays put (D8 — only the server's verdict may discard it) and can never
  // starve the live session out of its own upload budget.
  const live = await vtdb.head(rec.sessionId, UPLOAD_BATCH);
  if (!live.length) {
    noteSync();
    return true;
  }

  // Phase 1 — blobs. A shot/rrweb item owes its bytes before its event row can
  // reference them, and each is its own request. FIFO is strict: a transient
  // failure stops the pass rather than reordering the stream.
  for (const item of live) {
    if (!item.needsBlob) continue;
    const path = item.kind === "shot"
      ? `/api/v1/sessions/${rec.sessionId}/shot?seq=${item.seq}`
      : `/api/v1/sessions/${rec.sessionId}/chunk?seq=${item.seq}`;
    try {
      const up = await api("POST", path, item.blob, item.blobCT);
      await vtdb.resolveBlob(rec.sessionId, item.seq, up.blobKey);
      item.blobKey = up.blobKey;
      item.needsBlob = 0;
      noteSync();
    } catch (e) {
      const st = statusOf(e);
      if (permanentStatus(st)) {
        // Retrying forever would wedge the FIFO behind one bad item.
        console.warn(`vitrinka: ${item.kind} seq ${item.seq} rejected permanently (${st}) — dropped`, e);
        await vtdb.remove(rec.sessionId, [item.seq]);
        // Mark it, don't leave needsBlob set: phase 2 stops at the first item
        // that still owes a blob, so a dropped one would act as a permanent
        // barrier and nothing behind it would ever be sent.
        item.dropped = true;
        continue;
      }
      noteFailure(e);
      scheduleFlush();
      return false;
    }
  }

  // Phase 2 — event rows, everything at the head that owes nothing.
  const ready = [];
  for (const item of live) {
    if (item.dropped) continue; // phase 1 removed it from the queue entirely
    if (item.needsBlob) break; // FIFO: stop at the first unresolved blob
    ready.push(item);
  }
  if (!ready.length) {
    scheduleFlush();
    return false;
  }
  const events = ready.map((i) => ({
    seq: i.seq, ts: i.ts, tabId: i.tabId, tabHost: i.tabHost,
    kind: i.kind, payload: i.payload, blobKey: i.blobKey,
  }));
  try {
    await api("POST", `/api/v1/sessions/${rec.sessionId}/events`, { events });
  } catch (e) {
    const st = statusOf(e);
    if (permanentStatus(st)) {
      // D9: a 409 from a session the server already closed used to retry every
      // 2s for the life of the browser profile, keeping the queue on disk
      // forever. A permanent verdict is terminal — say so and stop.
      await markSessionDead(`server rejected this session (${st})`);
      return false;
    }
    noteFailure(e);
    scheduleFlush();
    return false;
  }
  noteSync();
  // A 200 IS the server confirming it holds these seqs — take it. Waiting for
  // the 10s reconcile tick instead left a freshly-started recorder showing
  // "server has 0 / 3" and a noncommittal glyph for the first ten seconds,
  // which is exactly the window where a tester wants to know it is working.
  const top = events[events.length - 1].seq;
  if (top > serverMaxSeq) serverMaxSeq = top;
  await vtdb.remove(rec.sessionId, ready.map((i) => i.seq));
  const left = await vtdb.head(rec.sessionId, 1);
  if (left.length) {
    scheduleFlush(0);
    return false;
  }
  return true;
}

// drainQueue pushes until the queue is empty or the deadline passes,reporting
// progress as it goes — D2's Stop shows real numbers, and the HUD mirrors them
// because an MV3 popup dies the moment it loses focus. A timed-out tail is
// never deleted.
async function drainQueue(deadlineMs = STOP_DRAIN_MS) {
  const t0 = Date.now();
  const sid = (await getState() || {}).sessionId;
  if (!sid) return true;
  const mine = () => vtdb.sessionStats(sid);
  const total = Math.max(1, (await mine()).count);
  while (Date.now() - t0 < deadlineMs) {
    const st = await mine();
    wrapping = { total, left: st.count, blobs: st.blobs };
    await broadcastHealth();
    if (!st.count) return true;
    const ok = await flush();
    const rec = await getState();
    if (rec && rec.dead) return false; // no point retrying a dead session
    if (!ok) await sleep(1000);
  }
  return (await mine()).count === 0;
}

// markSessionDead records that the SERVER will not accept this session's
// events any more (D9). The queue is kept — the tester can still export or
// inspect it — but the pointless retry loop stops here.
async function markSessionDead(reason) {
  const rec = await getState();
  if (!rec || rec.dead) return;
  rec.dead = true;
  rec.deadReason = reason;
  await setState(rec);
  console.warn("vitrinka: session marked dead —", reason);
  await badge("dead");
  await broadcastHealth();
}

// ---------------------------------------------------------------------------
// server reconciliation + dead-session reaping (D5/D9)

// reconcile asks the server what it actually holds. Two answers matter: the
// maxSeq the HUD reconciles against, and whether the session still exists at
// all. Only the SERVER's verdict may declare local data reapable.
async function reconcile() {
  const rec = await getState();
  if (!rec) return null;
  let ses;
  try {
    ses = await api("GET", `/api/v1/sessions/${rec.sessionId}`);
  } catch (e) {
    if (statusOf(e) === 404) {
      await markSessionDead("session no longer exists on the server");
      return null;
    }
    noteFailure(e);
    return null;
  }
  serverMaxSeq = Number(ses.maxSeq || 0);
  if (!rec.stopping && (ses.status === "done" || ses.deletedAt)) {
    await markSessionDead(ses.deletedAt ? "session was deleted" : "session was closed on the server");
  }
  await broadcastHealth();
  return ses;
}

// reapDeadSessions clears queue data for sessions the server considers gone.
// LIVE data is never touched (D8/D9): the only thing that authorizes a delete
// is the server saying done / deleted / 404 for that exact session id.
async function reapDeadSessions() {
  const st = await vtdb.stats().catch(() => null);
  if (!st || !st.count) return;
  const rec = await getState();
  for (const key of Object.keys(st.bySession)) {
    const sessionId = Number(key);
    if (!sessionId) continue;
    if (rec && rec.sessionId === sessionId && !rec.dead) continue; // the live one
    let dead = false;
    try {
      const ses = await api("GET", `/api/v1/sessions/${sessionId}`);
      dead = ses.status === "done" || !!ses.deletedAt;
    } catch (e) {
      if (statusOf(e) === 404) dead = true;
      else continue; // server unreachable — decide nothing, try again later
    }
    if (!dead) continue;
    const n = await vtdb.dropSession(sessionId);
    console.warn(`vitrinka: reaped ${n} item(s) of finished session ${sessionId}`);
    if (rec && rec.sessionId === sessionId) {
      await setState(null);
      await badge("off");
    }
  }
}

// ---------------------------------------------------------------------------
// tab attachment: content script + CDP

async function tabInfo(tabId) {
  const rec = await getState();
  return rec && rec.tabs && rec.tabs[String(tabId)];
}

async function attachTab(tabId, url) {
  const rec = await getState();
  if (!rec || rec.tabs[String(tabId)]) return;
  let host = "";
  try { host = new URL(url).host; } catch { return; }
  if (!host || !/^https?:/.test(url)) return;
  rec.nextTab = (rec.nextTab || 0) + 1; // monotonic: lane ids never reused after tab close
  rec.tabs[String(tabId)] = { id: `tab${rec.nextTab}`, host, cdp: false };
  await setState(rec);

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["vendor/rrweb-record.min.js", "content.js"] });
  } catch (e) {
    console.warn("vitrinka: content inject failed", tabId, e);
  }
  // CDP network capture (D2). Attach can fail (DevTools open, another
  // debugger) — degrade to no-network rather than blocking the recording.
  if (!(await getConfig()).captureNetwork) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    // Page-world console errors (the isolated-world wrap saw only extension
    // calls): CDP Runtime delivers the app's own console + uncaught errors.
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {}).catch(() => {});
    // Workers + service workers carry the app mutations on modern stacks
    // (first fixit run recorded 125 GETs and ZERO POSTs — all mutations rode
    // targets the page session never saw). Auto-attach flattened sessions and
    // enable Network on each as it appears.
    if ((await getConfig()).captureWorkers) {
      await chrome.debugger.sendCommand({ tabId }, "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    }
    const rec2 = await getState();
    if (rec2 && rec2.tabs[String(tabId)]) { rec2.tabs[String(tabId)].cdp = true; await setState(rec2); }
  } catch (e) {
    console.warn("vitrinka: CDP attach failed — recording without network bodies", tabId, String(e));
  }
}

async function detachAll() {
  const rec = await getState();
  if (!rec) return;
  const waits = [];
  for (const tabId of Object.keys(rec.tabs)) {
    const id = Number(tabId);
    if (rec.tabs[tabId].cdp) chrome.debugger.detach({ tabId: id }).catch(() => {});
    // Await each content script's vt-stop ack — it hands over its final rrweb
    // batch before responding, so the drain below sees the complete stream.
    waits.push(chrome.tabs.sendMessage(id, { type: "vt-stop" }).catch(() => {}));
  }
  await Promise.allSettled(waits);
}

// In-flight CDP requests per "tabId:sessionId:requestId" (small + transient —
// plain memory is fine; a SW restart only drops requests mid-flight).
const inflight = new Map();

// Headers ride along capped (D2 "all headers"): individual values bounded,
// total budget ~8 KiB per side so one giant cookie can't bloat the event.
function capHeaders(h) {
  if (!h) return undefined;
  const out = {};
  let budget = 8192;
  for (const [k, v] of Object.entries(h)) {
    const val = String(v).slice(0, 1024);
    budget -= k.length + val.length;
    if (budget < 0) { out["…"] = "(truncated)"; break; }
    out[k] = val;
  }
  return out;
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  // Target attachment is LIFECYCLE, not capture — it must run even while
  // paused, or a worker spawned mid-pause records nothing after resume.
  if (method === "Target.attachedToTarget") {
    chrome.debugger.sendCommand({ tabId: source.tabId, sessionId: params.sessionId }, "Network.enable", {}).catch(() => {});
    chrome.debugger.sendCommand({ tabId: source.tabId, sessionId: params.sessionId }, "Runtime.enable", {}).catch(() => {});
    chrome.debugger.sendCommand({ tabId: source.tabId, sessionId: params.sessionId }, "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    return;
  }
  const rec = await getState();
  if (!capturing(rec)) {
    // Requests that finish while paused must still leave the inflight map,
    // or their entries leak for the rest of the recording.
    if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      inflight.delete(`${source.tabId}:${source.sessionId || ""}:${params.requestId}`);
    }
    return;
  }
  const tab = rec.tabs[String(source.tabId)];
  if (!tab) return;
  if (method === "Runtime.consoleAPICalled" && params.type === "error") {
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: {
      level: "error",
      text: (params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 500),
    } }]);
    return;
  }
  if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: {
      level: "error",
      text: (d.exception && (d.exception.description || d.exception.value) || d.text || "uncaught exception").slice(0, 500),
    } }]);
    return;
  }
  if (method === "Network.webSocketCreated") {
    // WS visibility (D2): connection-level capture; frame capture is a
    // documented follow-up (README known limits).
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "request", payload: {
      method: "WS", url: params.url, status: 101, type: "WebSocket",
    } }]);
    return;
  }
  const key = `${source.tabId}:${source.sessionId || ""}:${params.requestId}`;
  if (method === "Network.requestWillBeSent") {
    const r = params.request;
    inflight.set(key, {
      method: r.method, url: r.url, reqBody: (r.postData || "").slice(0, BODY_CAP),
      reqHeaders: capHeaders(r.headers),
      start: params.timestamp, type: params.type, sessionId: source.sessionId,
    });
  } else if (method === "Network.responseReceived") {
    const f = inflight.get(key);
    if (f) {
      f.status = params.response.status; f.mime = params.response.mimeType; f.type = params.type;
      f.resHeaders = capHeaders(params.response.headers);
    }
  } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    const f = inflight.get(key);
    inflight.delete(key);
    if (!f) return;
    const failed = method === "Network.loadingFailed" || (f.status || 0) >= 400;
    // Surface app-ish traffic (XHR/fetch/document) — plus ANY failure,
    // whatever its resource type. A missed error is the worst outcome.
    if (!["XHR", "Fetch", "Document"].includes(f.type || "") && !failed) return;
    let resBody = "";
    const wantBody = method === "Network.loadingFinished" &&
      ((f.status || 0) >= 400 || (/json|text|xml/.test(f.mime || "") && f.type !== "Document"));
    if (wantBody) {
      try {
        const target = f.sessionId ? { tabId: source.tabId, sessionId: f.sessionId } : { tabId: source.tabId };
        const b = await chrome.debugger.sendCommand(target, "Network.getResponseBody", { requestId: params.requestId });
        resBody = (b.base64Encoded ? "" : b.body || "").slice(0, BODY_CAP);
      } catch { /* body already gone — metadata still lands */ }
    }
    await pushEvents([{
      tabId: tab.id, tabHost: tab.host, kind: "request",
      payload: {
        method: f.method, url: f.url, status: f.status || 0,
        // CDP resource type (Document/Script/XHR/…): the waterfall's chip
        // filter buckets by it; older recordings fall back to a URL heuristic.
        type: f.type || undefined,
        ms: f.start && params.timestamp ? Math.round((params.timestamp - f.start) * 1000) : undefined,
        reqBody: f.reqBody || undefined, resBody: resBody || undefined,
        reqHeaders: f.reqHeaders, resHeaders: f.resHeaders,
        error: method === "Network.loadingFailed" ? params.errorText : undefined,
      },
    }]);
  }
});

chrome.debugger.onDetach.addListener(async (source) => {
  const rec = await getState();
  if (!rec) return;
  const tab = rec.tabs[String(source.tabId)];
  if (tab) { tab.cdp = false; await setState(rec); }
});

// ---------------------------------------------------------------------------
// screenshots — captureVisibleTab is active-tab-only + rate-limited
//
// D6: capture enqueues and RETURNS. It used to await a full PNG POST before
// acknowledging, which put a network round trip on the click path and made
// bursts of clicks queue behind each other on the worker's one thread.

let lastShot = 0;
// Per-tab hash of the last captured frame (sessions-UI D8 dedupe): identical
// consecutive captures skip the upload — long sessions parked on one screen
// stop accumulating byte-identical PNGs. In-memory only; a SW restart just
// costs one duplicate frame. Deliberate ⌖ snaps bypass it (payload.snap).
const lastShotHash = new Map();
function shotHash(s) {
  let h = 0x811c9dc5;
  // FNV-1a over the dataURL, sampled — hashing multi-MB strings per frame
  // would burn the SW's CPU budget; a 512-stride sample still flips on any
  // real pixel change because PNG bytes cascade.
  for (let i = 0; i < s.length; i += 512) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return s.length + ":" + (h >>> 0).toString(36);
}

async function shoot(tabId, payload) {
  const rec = await getState();
  if (!capturing(rec)) return;
  const tab = rec.tabs[String(tabId)];
  if (!tab) return;
  // The session this frame belongs to, fixed BEFORE the capture awaits below
  // (review r3650595572): a stop — or a stop followed by a start — completing
  // during them would otherwise file these pixels into whatever session is
  // live when the encode finishes.
  const startedIn = rec.sessionId;
  const now = Date.now();
  if (now - lastShot < SHOT_THROTTLE_MS) return;
  lastShot = now;
  let active;
  try { active = await chrome.tabs.get(tabId); } catch { return; }
  if (!active.active) return; // background tabs get their shot on tab-switch
  let dataURL;
  try {
    dataURL = await chrome.tabs.captureVisibleTab(active.windowId, { format: "png" });
  } catch (e) {
    console.warn("vitrinka: captureVisibleTab failed", String(e));
    return;
  }
  const hash = shotHash(dataURL);
  if (!payload || !payload.snap) {
    if (lastShotHash.get(String(tabId)) === hash) return;
  }
  lastShotHash.set(String(tabId), hash);
  // Re-validate across the capture awaits, then hold allocSeq to its answer:
  // the early check avoids burning a seq in the common case, the comparison
  // closes the window entirely.
  if (!capturing(await getState())) return;
  const alloc = await allocSeq();
  if (!alloc || alloc.sessionId !== startedIn) return;
  // Native Blob into the queue — no base64 dataURL sitting on disk (D7).
  // The encode below is an await, so the item is filed under the session the
  // seq came from, never whatever is live once it finishes.
  const blob = await (await fetch(dataURL)).blob();
  await enqueue({
    sessionId: alloc.sessionId, seq: alloc.seq,
    ts: new Date().toISOString(), tabId: tab.id, tabHost: tab.host,
    kind: "shot", payload, blob, blobCT: "image/png",
  });
}

// ---------------------------------------------------------------------------
// lifecycle

async function startSession(title) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || !/^https?:/.test(active.url || "")) throw new Error("open the app you want to record first");
  const host = new URL(active.url).host;
  const ses = await api("POST", "/api/v1/sessions", {
    host, title: title || "", meta: { userAgent: navigator.userAgent, recorder: "extension/" + chrome.runtime.getManifest().version },
  });
  await setState({
    sessionId: ses.id, project: ses.project, environment: ses.environment,
    title: ses.title, startedAt: ses.startedAt, seq: 0, paused: false, tabs: {},
    // Active-time bookkeeping: elapsed = activeMs + (now - resumeAt while
    // running). The HUD clock freezes on pause because of this, not luck.
    activeMs: 0, resumeAt: new Date().toISOString(),
  });
  serverMaxSeq = 0;
  lastSyncAt = Date.now();
  failures = 0;
  lastError = "";
  wrapping = null;
  // Anything still queued belongs to an earlier session; the reaper clears it
  // once the server confirms, and flush drops it on sight either way.
  await reapDeadSessions().catch(() => {});
  await attachTab(active.id, active.url);
  await shoot(active.id, { route: routeOf(active.url), title: active.title, url: active.url });
  await badge("rec");
  armReconcile();
  return ses;
}

// V3 (recorder-v2): adopt an earlier session and keep recording it — the
// popup's Continue. Reopens server-side (done→recording), continues the seq
// stream from maxSeq, attaches the active tab; stop appends to the SAME
// set + board (import-set dedups what's already placed).
async function continueSession(sessionId) {
  const ses = await api("GET", `/api/v1/sessions/${sessionId}`);
  await api("PATCH", `/api/v1/sessions/${sessionId}`, { status: "recording" });
  await setState({
    sessionId: ses.id, project: ses.project, environment: ses.environment,
    title: ses.title, startedAt: new Date().toISOString(), seq: ses.maxSeq || 0,
    paused: false, tabs: {}, activeMs: 0, resumeAt: new Date().toISOString(),
  });
  serverMaxSeq = Number(ses.maxSeq || 0);
  lastSyncAt = Date.now();
  failures = 0;
  lastError = "";
  wrapping = null;
  await reapDeadSessions().catch(() => {});
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && /^https?:/.test(active.url || "")) {
    await attachTab(active.id, active.url);
    await shoot(active.id, { route: routeOf(active.url), title: active.title, url: active.url });
  }
  await badge("rec");
  armReconcile();
  return ses;
}

// stopSession ends the recording (D2): capture freezes at once, the queue is
// drained with visible progress, and the session is closed. The BOARD is not
// waited for — the server builds it on a worker and the recorder learns it is
// ready by polling (D11), so Stop and Show-board are separate acts (D3).
async function stopSession() {
  const rec = await getState();
  if (!rec) return null;
  if (!rec.stopping) {
    // Freeze new capture immediately; the clock stops here too. `stopping` is
    // not `paused` on purpose — detachAll still needs each tab's final rrweb
    // batch to be accepted.
    rec.stopping = true;
    rec.activeMs = elapsedOf(rec);
    await setState(rec);
  }
  await badge("wrap");
  await broadcastHealth();

  // Detach FIRST: it awaits each tab's final rrweb batch, which must be in the
  // queue before the drain below.
  await detachAll();
  const drained = await drainQueue((await getConfig()).stopDrainMs);
  if (!drained) {
    const st = await vtdb.sessionStats(rec.sessionId);
    const dead = (await getState() || {}).dead;
    wrapping = null;
    await badge(dead ? "dead" : "off");
    scheduleFlush();
    await broadcastHealth();
    throw new Error(dead
      ? `this session was closed on the server — ${st.count} item(s) kept on disk`
      : `server unreachable — ${st.count} item(s) kept on disk; stop again once online`);
  }

  let done = null;
  try {
    done = await api("PATCH", `/api/v1/sessions/${rec.sessionId}`, { status: "done" });
  } catch (e) {
    const status = statusOf(e);
    if (permanentStatus(status)) {
      // Permanent verdict (session deleted, auth revoked…): retrying can never
      // succeed — complete the stop locally so the user isn't wedged.
      console.warn("vitrinka: stop rejected permanently — clearing local session", e);
    } else {
      // Transient: keep everything, let the user retry.
      console.warn("vitrinka: stop PATCH failed — session kept", e);
      await broadcastHealth();
      throw e;
    }
  }
  const sessionId = rec.sessionId;
  const title = rec.title || `Session #${sessionId}`;
  await setState(null);
  await vtdb.dropSession(sessionId).catch(() => {});
  wrapping = null;
  serverMaxSeq = -1;
  disarmReconcile();
  await badge("off");
  // D3: the board is a separate, deliberate act. Watch for it to be ready and
  // tell the tester when it is — never steal focus with a tab.
  if (done) await watchForBoard(sessionId, title, done);
  return done;
}

function elapsedOf(rec) {
  if (!rec) return 0;
  let ms = rec.activeMs || 0;
  if (!rec.paused && !rec.stopping && rec.resumeAt) ms += Date.now() - Date.parse(rec.resumeAt);
  return ms;
}

async function togglePause() {
  const rec = await getState();
  if (!rec || rec.stopping) return;
  rec.paused = !rec.paused;
  if (rec.paused) {
    rec.activeMs = (rec.activeMs || 0) + (rec.resumeAt ? Date.now() - Date.parse(rec.resumeAt) : 0);
    rec.resumeAt = null;
  } else {
    rec.resumeAt = new Date().toISOString();
  }
  await setState(rec);
  // The HUD in every recorded tab mirrors the state — popup-pause was
  // invisible to the pill before this broadcast.
  for (const tabId of Object.keys(rec.tabs)) {
    chrome.tabs.sendMessage(Number(tabId), { type: "vt-paused", paused: rec.paused, elapsedMs: elapsedOf(rec) }).catch(() => {});
  }
  await api("PATCH", `/api/v1/sessions/${rec.sessionId}`, { status: rec.paused ? "paused" : "recording" }).catch(() => {});
  await badge(rec.paused ? "pause" : "rec");
  await broadcastHealth();
  return rec.paused;
}

// ---------------------------------------------------------------------------
// board readiness (D3/D11)
//
// The projection now runs on a server worker, so the board arrives AFTER the
// stop request returns. A service-worker global has no EventSource, and
// holding a fetch stream open would pin the worker alive only for Chrome to
// terminate it at its cap — so the recorder polls over the bounded stop→ready
// window, with a chrome.alarm as the resurrection backstop if the worker is
// killed mid-wait. The web surfaces get the real SSE stream instead.

async function watchForBoard(sessionId, title, initial) {
  const state = { sessionId, title, since: Date.now() };
  await chrome.storage.local.set({ awaiting: state });
  chrome.alarms.create("vt-board-ready", { periodInMinutes: 0.5 });
  if (initial && initial.projection && initial.projection.state === "ready") {
    return announceBoard(initial);
  }
  pollForBoard();
}

let boardPollTimer = null;
function pollForBoard() {
  if (boardPollTimer) return;
  boardPollTimer = setTimeout(async () => {
    boardPollTimer = null;
    const { awaiting } = await chrome.storage.local.get("awaiting");
    if (!awaiting) return;
    if (Date.now() - awaiting.since > READY_GIVE_UP_MS) {
      await chrome.storage.local.remove("awaiting");
      chrome.alarms.clear("vt-board-ready");
      return;
    }
    let ses;
    try {
      ses = await api("GET", `/api/v1/sessions/${awaiting.sessionId}`);
    } catch {
      pollForBoard(); // transient — keep waiting
      return;
    }
    const p = ses.projection || {};
    if (p.state === "ready" && ses.boardSlug) return announceBoard(ses);
    if (p.state === "failed" || p.state === "empty") {
      await chrome.storage.local.remove("awaiting");
      chrome.alarms.clear("vt-board-ready");
      if (p.state === "failed") notify("Session couldn't be projected", p.error || "see the sessions page");
      return;
    }
    pollForBoard();
  }, READY_POLL_MS);
}

async function announceBoard(ses) {
  const { awaiting } = await chrome.storage.local.get("awaiting");
  await chrome.storage.local.remove("awaiting");
  chrome.alarms.clear("vt-board-ready");
  const { base } = await getConfig();
  const url = (ses.board && ses.board.url) || `${base}/boards/${ses.boardSlug}`;
  // Remembered so the popup can offer "Open board" for the last recording
  // even if the notification was missed.
  await chrome.storage.local.set({ lastBoard: {
    sessionId: ses.id, title: (awaiting && awaiting.title) || ses.title, url, at: Date.now(),
  } });
  notify("Board ready", `${(awaiting && awaiting.title) || ses.title} — click to open`, url);
}

function notify(title, message, url) {
  if (!chrome.notifications) return;
  const id = "vt-" + Date.now();
  if (url) notifyTargets.set(id, url);
  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/128.png"),
    title: `Vitrinka · ${title}`,
    message,
  }, () => void chrome.runtime.lastError);
}
const notifyTargets = new Map();
if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((id) => {
    const url = notifyTargets.get(id);
    if (url) chrome.tabs.create({ url });
    notifyTargets.delete(id);
    chrome.notifications.clear(id);
  });
}

// ---------------------------------------------------------------------------
// periodic work

let reconcileTimer = null;
function armReconcile() {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => { reconcile().catch(() => {}); }, RECONCILE_MS);
  // A worker killed between ticks loses the interval; the alarm restores it.
  chrome.alarms.create("vt-reconcile", { periodInMinutes: 0.5 });
}
function disarmReconcile() {
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  chrome.alarms.clear("vt-reconcile");
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "vt-reconcile") {
    const rec = await getState();
    if (!rec) return disarmReconcile();
    armReconcile();
    await reconcile().catch(() => {});
    scheduleFlush();
  } else if (alarm.name === "vt-board-ready") {
    const { awaiting } = await chrome.storage.local.get("awaiting");
    if (!awaiting) return void chrome.alarms.clear("vt-board-ready");
    pollForBoard();
  } else if (alarm.name === "vt-ext-update") {
    await maybeSelfReload(true).catch(() => {});
  }
});

async function badge(mode) {
  const text = { rec: "REC", pause: "❙❙", wrap: "…", dead: "!", off: "" }[mode] ?? "";
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({
      color: mode === "dead" ? "#b3261e" : mode === "rec" ? "#ff3b57" : "#756e68",
    });
  }
}

function routeOf(url) {
  try { return new URL(url).pathname; } catch { return ""; }
}

// ---------------------------------------------------------------------------
// wiring

// New tabs / navigations on the same project's domains auto-join the session
// (multi-tab journeys: admin + web side by side).
chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const rec = await getState();
  if (!capturing(rec)) return;
  const known = rec.tabs[String(d.tabId)];
  if (known) {
    // Full navigation re-injects the content script.
    await pushEvents([{ tabId: known.id, tabHost: known.host, kind: "nav", payload: { url: d.url, route: routeOf(d.url) } }]);
    try {
      await chrome.scripting.executeScript({ target: { tabId: d.tabId }, files: ["vendor/rrweb-record.min.js", "content.js"] });
    } catch { /* chrome:// etc. */ }
    await shoot(d.tabId, { route: routeOf(d.url), url: d.url });
    return;
  }
  // Unknown tab: join only when its host resolves to the session's project.
  let host = "";
  try { host = new URL(d.url).host; } catch { return; }
  if (!host) return;
  try {
    const r = await api("GET", `/api/v1/projects/resolve?host=${encodeURIComponent(host)}`);
    if (r.matched && r.project === rec.project) {
      await attachTab(d.tabId, d.url);
      await pushEvents([{ tabId: (await tabInfo(d.tabId)).id, tabHost: host, kind: "nav", payload: { url: d.url, route: routeOf(d.url) } }]);
      await shoot(d.tabId, { route: routeOf(d.url), url: d.url });
    }
  } catch { /* resolve down — tab simply doesn't join */ }
});

// SPA navigations (History API) come from webNavigation, not the page.
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const tab = await tabInfo(d.tabId);
  if (!tab) return;
  await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "nav", payload: { url: d.url, route: routeOf(d.url), spa: true } }]);
  await shoot(d.tabId, { route: routeOf(d.url), url: d.url });
});

// Tab switch: give the newly visible tab a keyframe (background tabs can't be
// captured, so this is where they catch up).
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await tabInfo(tabId);
  if (!tab) return;
  const t = await chrome.tabs.get(tabId).catch(() => null);
  if (t) await shoot(tabId, { route: routeOf(t.url || ""), title: t.title, url: t.url });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getState();
  if (rec && rec.tabs[String(tabId)]) {
    delete rec.tabs[String(tabId)];
    await setState(rec);
  }
});

// ---------------------------------------------------------------------------
// self-update over the native-messaging host
//
// This extension is UNPACKED, so Chrome never auto-updates it — but it DOES
// re-read the whole folder from disk on chrome.runtime.reload(). We can't write
// our own folder, so `vitrinka extension host` (the CLI) does the swap and we
// reload into it. Everything here degrades to nothing when the host is absent:
// the popup then falls back to the old download-and-↻ instructions.
const HOST = "in.vitrinka.updater";
// Chrome's own wording when no host manifest names us.
const HOST_ABSENT = /not found|forbidden|denied/i;

function hostCall(cmd, extra) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd, ...extra }, (reply) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const msg = err.message || String(err);
          return resolve({ ok: false, error: msg, absent: HOST_ABSENT.test(msg) });
        }
        resolve(reply || { ok: false, error: "the host replied with nothing" });
      });
    } catch (e) {
      // sendNativeMessage throws synchronously when the permission is missing.
      const msg = String((e && e.message) || e);
      resolve({ ok: false, error: msg, absent: true });
    }
  });
}

// seedConfig — first run on a machine that already has the CLI configured: take
// the base URL and token from it instead of making the tester paste them. Only
// ever FILLS empty settings; whatever the options page saved always wins.
async function seedConfig() {
  const { base = "", token = "" } = await chrome.storage.local.get(["base", "token"]);
  if (base && token) return false;
  const r = await hostCall("config");
  if (!r.ok) return false;
  const patch = {};
  if (!base && r.base) patch.base = String(r.base).replace(/\/$/, "");
  if (!token && r.token) patch.token = String(r.token);
  if (!Object.keys(patch).length) return false;
  await chrome.storage.local.set(patch);
  console.info("vitrinka: settings seeded from the vitrinka CLI on this machine");
  return true;
}

// extUpdateStatus — what the popup renders. `host` is the interesting axis:
// "absent" means no in-place updates on this machine (manual path), "ok" means
// the button can do the whole job.
async function extUpdateStatus() {
  const running = chrome.runtime.getManifest().version;
  const r = await hostCall("check");
  if (!r.ok) {
    return { running, host: r.absent ? "absent" : "error", error: r.error, latest: "", disk: "" };
  }
  return {
    running,
    host: "ok",
    disk: r.disk || "",
    latest: r.latest || "",
    error: r.error || "",
    // The host reached US but could not reach the shelf: it answers ok:true with
    // an empty `latest` and an error string. That is NOT "you are current" — the
    // question went unanswered, and every surface must say so.
    checkFailed: !r.latest && !!r.error,
    // The disk copy already outranks us: someone ran `vitrinka extension
    // update` in a terminal and a plain reload is all that's left to do.
    staged: !!r.disk && newerVersion(r.disk, running),
    available: !!r.latest && newerVersion(r.latest, running),
  };
}

// applyUpdate downloads + swaps via the host. It does NOT reload — the caller
// does, so the popup can say what happened before the world restarts.
async function applyUpdate() {
  if (await getState()) {
    // A reload tears down the CDP attach and the content scripts mid-session.
    // Recorded evidence outranks being current.
    return { ok: false, error: "stop the recording first — updating restarts the extension" };
  }
  const r = await hostCall("update");
  if (!r.ok) return r;
  return { ok: true, from: r.from, to: r.to, changed: !!r.changed };
}

// A periodic check keeps a machine current without anyone opening the popup:
// when the folder on disk already outranks what's running, reload into it.
// Never mid-session, and never while a board is still being built.
const EXT_CHECK_PERIOD_MIN = 60;
async function maybeSelfReload(force = false) {
  if (await getState()) return;
  const { awaiting, extCheckedAt = 0 } = await chrome.storage.local.get(["awaiting", "extCheckedAt"]);
  if (awaiting) return;
  // boot() runs on EVERY worker wake, and each hostCall spawns a host process
  // (Chrome execs the shim per message) — so the clock, not the wake, decides
  // when we actually ask. The alarm passes force.
  if (!force && Date.now() - extCheckedAt < EXT_CHECK_PERIOD_MIN * 60_000) return;
  await chrome.storage.local.set({ extCheckedAt: Date.now() });
  const r = await hostCall("check");
  if (!r.ok || !r.disk) return;
  if (newerVersion(r.disk, chrome.runtime.getManifest().version)) {
    console.info(`vitrinka: reloading into ${r.disk} from disk`);
    chrome.runtime.reload();
  }
}

// Messages from content scripts + popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tab = sender.tab ? await tabInfo(sender.tab.id) : null;
    switch (msg.type) {
      case "vt-click":
        if (tab) {
          await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "click", payload: msg.payload }]);
          await shoot(sender.tab.id, { route: msg.route, title: sender.tab.title, url: sender.tab.url });
        }
        return sendResponse({ ok: true });
      case "vt-note":
        if (tab) await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "note", payload: msg.payload }]);
        return sendResponse({ ok: true });
      case "vt-snap":
        if (tab) {
          if (msg.payload.note) {
            await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "note", payload: { text: msg.payload.note, rect: msg.payload.rect, selector: msg.payload.selector, annotate: true } }]);
          }
          lastShot = 0; // a deliberate snap always captures
          await shoot(sender.tab.id, { route: msg.route, title: sender.tab.title, url: sender.tab.url, snap: true });
        }
        return sendResponse({ ok: true });
      case "vt-console":
        if (tab) await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: msg.payload }]);
        return sendResponse({ ok: true });
      case "vt-vitals":
        // Web Vitals per step (sessions-UI D8): one LCP/CLS/INP event per
        // loaded document; the timeline renders it as a ⚡ chip on the step.
        if (tab) await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "vitals", payload: msg.payload }]);
        return sendResponse({ ok: true });
      case "vt-rrweb": {
        const rec = await getState();
        // Accepted while `stopping` on purpose: detachAll's final batch is the
        // tail of the recording and must not be refused.
        if (rec && tab && !rec.paused && !rec.dead) {
          const { parts, bodies, dropped } = splitRRWebEvents(msg.events);
          // A dropped event (alone beyond the wire cap — realistically the
          // inlined full snapshot) can make the rest of the recording
          // unreplayable. Surface it ON the session timeline, not just in a
          // SW console nobody inspects.
          if (dropped.length) {
            console.warn(`vitrinka: ${dropped.length} rrweb event(s) exceed the chunk cap (${dropped.join(", ")} bytes) — dropped`);
            try {
              const notes = dropped.map((b) => ({ tabId: tab.id, tabHost: tab.host, kind: "note",
                payload: { text: `⚠ rrweb event dropped (${(b / 1048576).toFixed(1)} MiB > chunk cap) — replay may be incomplete from here` } }));
              const na = await allocSeq(notes.length);
              if (na) {
                for (let i = 0; i < notes.length; i++) {
                  await vtdb.put({ sessionId: na.sessionId, seq: na.seq + i, ts: new Date().toISOString(), ...notes[i] });
                }
              }
            } catch (e) { console.warn("vitrinka: drop-note write failed", e); }
          }
          const alloc = parts.length ? await allocSeq(parts.length) : null;
          for (let pi = 0; alloc && pi < parts.length; pi++) {
            await vtdb.put({
              sessionId: alloc.sessionId, seq: alloc.seq + pi, ts: new Date().toISOString(),
              tabId: tab.id, tabHost: tab.host, kind: "rrweb",
              payload: { count: parts[pi].length },
              blob: new Blob([bodies[pi]], { type: "application/json" }),
              blobCT: "application/json",
            });
          }
          scheduleFlush();
        }
        return sendResponse({ ok: true });
      }
      case "vt-status": {
        const rec = await getState();
        return sendResponse({ rec, elapsedMs: elapsedOf(rec), health: await health() });
      }
      case "vt-health":
        return sendResponse(await health());
      case "vt-storage":
        return sendResponse(await vtdb.stats());
      case "vt-reap":
        try { await reapDeadSessions(); return sendResponse({ ok: true, stats: await vtdb.stats() }); }
        catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      case "vt-clear-all":
        // The manual escape hatch (D9). Refuses while a session is live —
        // recorded evidence is never thrown away behind the tester's back.
        if (await getState()) return sendResponse({ ok: false, error: "stop the recording first" });
        await vtdb.clear();
        return sendResponse({ ok: true, stats: await vtdb.stats() });
      case "vt-start":
        try { return sendResponse({ ok: true, session: await startSession(msg.title) }); }
        catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      case "vt-stop":
        try { return sendResponse({ ok: true, done: await stopSession() }); }
        catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      case "vt-pause":
        return sendResponse({ ok: true, paused: await togglePause() });
      case "vt-continue":
        try { return sendResponse({ ok: true, session: await continueSession(msg.sessionId) }); }
        catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      case "vt-ext-status":
        return sendResponse(await extUpdateStatus());
      case "vt-ext-update":
        try { return sendResponse(await applyUpdate()); }
        catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      case "vt-ext-config":
        // The options page asks for the CLI's settings on demand ("fill from
        // this machine"), which is the same call boot() makes silently.
        return sendResponse(await hostCall("config"));
    }
    sendResponse({ ok: false, error: "unknown message" });
  })();
  return true; // async sendResponse
});

// Test hooks (e2e drives the SW directly — same-context runtime messages are
// not delivered, so the popup path can't be reused from sw.evaluate).
globalThis.__vt = { startSession, stopSession, togglePause, continueSession, getState, flush, health };
// Self-update handles: e2e stubs chrome.runtime.sendNativeMessage to stand in
// for the CLI, since a real native host needs a user-level manifest outside the
// browser profile (extension-update.spec.ts).
globalThis.__vtUpdate = { extUpdateStatus, applyUpdate, seedConfig, hostCall, maybeSelfReload, boot: () => boot() };
// e2e-only handles for the durable-queue paths (harmless in production).
globalThis.__vtTest = { vtdb, drainQueue, reconcile, reapDeadSessions, shoot, splitRRWebEvents, enqueue };

// Keyboard commands relay to the active tab's HUD.
chrome.commands.onCommand.addListener(async (command) => {
  const rec = await getState();
  if (!rec) return;
  if (command === "toggle-pause") return void togglePause();
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && rec.tabs[String(active.id)]) {
    chrome.tabs.sendMessage(active.id, { type: command === "snap" ? "vt-pick" : "vt-note-ui" }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// boot — a tail queued before a browser quit lives in IndexedDB; drain it
// whenever the worker wakes (browser launch included), then reap whatever
// belongs to sessions the server has already finished (D9).
async function boot() {
  const rec = await getState();
  if (rec) {
    armReconcile();
    await reconcile().catch(() => {});
  }
  scheduleFlush(0);
  await reapDeadSessions().catch((e) => console.warn("vitrinka: reap failed", e));
  const { awaiting } = await chrome.storage.local.get("awaiting");
  if (awaiting) pollForBoard();
  // Self-update wiring: adopt the CLI's settings on a fresh install, then keep
  // the periodic disk check armed. Both are best-effort — a machine without the
  // native host recorded fine before this existed and still does.
  await seedConfig().catch((e) => console.warn("vitrinka: config seed failed", e));
  // Re-creating an alarm RESTARTS its period, and boot() runs on every worker
  // wake — so an unconditional create would push the 60-minute tick out
  // forever on a machine in active use. Only arm it when it isn't armed.
  if (!(await chrome.alarms.get("vt-ext-update"))) {
    chrome.alarms.create("vt-ext-update", { periodInMinutes: EXT_CHECK_PERIOD_MIN });
  }
  await maybeSelfReload().catch(() => {});
}
chrome.runtime.onStartup.addListener(() => { boot(); });
boot();
