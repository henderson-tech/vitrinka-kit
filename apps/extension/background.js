// Vitrinka Journey Recorder — background service worker.
//
// Decisions: journey recorder 2026-07-24 (D1 session event stream, D2
// chrome.debugger CDP network capture with graceful degrade, D3 rrweb chunks
// recorded now + rendered later, D7 capture-everything on a mesh-only tool)
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
import * as vtRedact from "./vendor/redact.js";
import { newerVersion } from "./version.js";
import { vtHeaders, WORKSPACE_HEADER } from "./wire.js";

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
// One readiness read's bound: a hung one is a transient miss, retried next tick.
const READY_READ_TIMEOUT_MS = 10_000;

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
  // workspace names which tenant this browser records into: a personal token
  // acts in every workspace its owner belongs to, so the server refuses with
  // 401 workspace_required when an account has more than one and the request
  // names none. Empty is valid — a single-workspace account never needs it.
  const { base = "", workspace = "", token = "", captureWorkers = true, captureNetwork = true, stopDrainMs = STOP_DRAIN_MS } =
    await chrome.storage.local.get(["base", "workspace", "token", "captureWorkers", "captureNetwork", "stopDrainMs"]);
  return { base: base.replace(/\/$/, ""), workspace, token, captureWorkers, captureNetwork, stopDrainMs };
}

async function getState() {
  const { rec = null } = await chrome.storage.local.get("rec");
  return rec;
}
async function setState(rec) {
  await chrome.storage.local.set({ rec });
}

// Continue reopens the same server id but starts a new local recording.
// Missing generations compare equal for a legacy row until its next adoption.
function sameRecording(current, expected) {
  return !!current && !!expected && current.sessionId === expected.sessionId && current.generation === expected.generation;
}

// capturing gates every NEW capture. `stopping` is deliberately separate from
// `paused`: Stop must freeze clicks/navs/shots immediately while still
// accepting each content script's final rrweb batch (detachAll awaits it).
function capturing(rec) {
  return !!rec && !rec.paused && !rec.stopping && !rec.dead;
}

// One async mutex serializes every read-modify-write of rec. The SW is
// single-threaded, but interleaved awaits let two producers read the same seq
// or clobber each other's writes (review #3644465006/#3644464994). Every
// other stored read-modify-write (the HUD's recents and prefs) gets a chain
// of its own from serialized(), so it never queues behind the capture path.
function serialized() {
  let chain = Promise.resolve();
  return (fn) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
}
const withLock = serialized();

// A session id is a number per deployment AND per workspace: #12 exists on
// two servers, and in two workspaces of one. Anything kept beyond the live
// recording (recents, the board wait, a queued tail) names its scope beside
// the id, and is only ever asked about on that base with that workspace.
async function scopeOf(workspace) {
  return { base: (await getConfig()).base, workspace: workspace || "" };
}
const scopeKey = (scope, sessionId) => `${scope.base}\n${scope.workspace || ""}\n${sessionId}`;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// HTTP status from an api() error — 0 when the failure never got a response.
function statusOf(e) {
  return Number((String(e && e.message).match(/→ (\d{3}):/) || [])[1] || 0);
}

// A server verdict that retrying can never fix (4xx minus timeout/rate-limit).
function permanentStatus(st) {
  return st >= 400 && st < 500 && st !== 408 && st !== 429;
}

// The workspace a call acts in: the live session's (pinned when the session
// was created — resolved from the tab's host across every membership, see
// startSession) over the options page's global default. One browser can
// record a fixit tab into fixit and a voke tab into voke without retyping
// the options page in between.
async function activeWorkspace(configWorkspace) {
  const rec = await getState();
  return (rec && rec.workspace) || configWorkspace || "";
}

async function api(method, path, body, contentType, opts = {}) {
  // opts.cred sends with exactly the settings read a caller already checked
  // (sendPrefs), never a fresh one a relink may have changed meanwhile.
  const { base, workspace, token } = opts.cred || await getConfig();
  if (!base) throw new Error("vitrinka base URL not configured (options page)");
  // opts.base pins a scoped read to the server its session lives on, checked
  // against the same settings read the request is built from: a switch since
  // the caller looked refuses it (no status, so callers treat it as
  // transient) instead of asking another deployment about the same #N.
  if ("base" in opts && opts.base !== base) throw new Error(`${method} ${path} not sent: the session lives on ${opts.base}, the recorder now points at ${base}`);
  const headers = vtHeaders(token, "workspace" in opts ? opts.workspace : await activeWorkspace(workspace));
  if (body !== undefined) headers["content-type"] = contentType || "application/json";
  const res = await fetch(base + path, {
    method, headers,
    body: body === undefined ? undefined : contentType ? body : JSON.stringify(body),
    // opts.timeoutMs bounds a call the UI waits on (the HUD's /recorder/me);
    // capture uploads stay unbounded on purpose — the queue retries them.
    ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------------------
// rrweb chunk splitting
//
// Serialized-size split for rrweb batches: with collectFonts on,
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
let liveBoard = { sessionId: null, url: "" }; // the recording's server-minted board link

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
    chunks: st.chunks || 0,
    sinceSyncMs: sinceSync,
    lastSyncAt: lastSyncAt || null,
    failures,
    error: lastError,
    sessionId: rec ? rec.sessionId : null,
    localSeq: rec ? rec.seq : 0,
    serverMaxSeq,
    // synced is the reconciliation itself: everything this recorder allocated
    // is accounted for on the server.
    synced: !!rec && serverMaxSeq >= 0 && serverMaxSeq >= (rec.seq || 0) && st.count === 0,
    deadReason: rec && rec.dead ? rec.deadReason : "",
    // The live board (D10) as the server addresses it — the HUD's ⋯ menu
    // links it while recording. Learned on reconcile, never composed.
    boardUrl: rec && liveBoard.sessionId === rec.sessionId ? liveBoard.url : "",
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
  maybePollPair(rec);
}

// ---------------------------------------------------------------------------
// pair-mode narration (pair decisions 2026-08-28 #2)
//
// While a session records, the HUD shows whether a Claude session is
// LISTENING for this project and what it is narrating (board_working) —
// so the tester learns "⟳ fixing №3 … / ✓ restarting, reload" without ever
// leaving the app under test. Piggybacked on broadcastHealth (the SW is
// reliably awake exactly while events flow) and throttled: a poll every ~5s
// while capture is active, silence otherwise. Failures show nothing — the
// pair line is narration, never health.

let pairLastPoll = 0;
let pairLastState = null; // { sessionId, pair } — keyed so a NEW recording never paints the previous session's state
async function maybePollPair(rec) {
  if (!rec || rec.dead || !rec.sessionId) return;
  // The websocket is the primary wire; this poll is its automatic fallback.
  // Try (re)connecting on every health beat — connectPairWS self-throttles —
  // and stay quiet while the socket is up for this exact session.
  connectPairWS().catch(() => {});
  if (pairSockOpen() && pairSockSession === rec.sessionId) return;
  if (pairLastState && pairLastState.sessionId !== rec.sessionId) {
    // Session changed: drop the stale state AND the throttle stamp, so the
    // new session's first line arrives now, not up to 5s late.
    pairLastState = null;
    pairLastPoll = 0;
  }
  if (Date.now() - pairLastPoll < 5000) return;
  pairLastPoll = Date.now();
  let pair;
  try {
    pair = await api("GET", `/api/v1/sessions/${rec.sessionId}/pair`);
  } catch {
    return; // keep the last known line; health owns outage messaging
  }
  pairLastState = { sessionId: rec.sessionId, pair };
  for (const tabId of Object.keys(rec.tabs || {})) {
    chrome.tabs.sendMessage(Number(tabId), { type: "vt-pair", pair }).catch(() => {});
  }
}
// pairStateFor answers vt-status: only ever the CURRENT session's state.
function pairStateFor(rec) {
  if (!rec || !pairLastState || pairLastState.sessionId !== rec.sessionId) return null;
  return pairLastState.pair;
}

// ---------------------------------------------------------------------------
// pair panel websocket (pair-panel decisions 2026-08-29)
//
// The panel's live wire: /api/v1/sessions/{id}/pair/ws streams item/reply/
// status/working/relay frames; while it is OPEN the ~5s /pair poll above goes
// quiet (it is the automatic fallback, not a sibling). The wire law is the
// server's: every durable write goes over REST via api() below (vt-pair-reply
// / vt-pair-new / vt-pair-accept / vt-pair-bounce), the socket only echoes.
//
// A browser WebSocket cannot carry an Authorization header, so a
// declarativeNetRequest session rule stamps the extension's Bearer credential
// onto websocket handshakes to the configured server — the exact same
// credential api() sends, on the exact same auth path server-side. The rule
// is scoped to (our host, websocket, /api/v1/sessions/) so it can never leak
// the token to another site.
//
// The server pings every ~15s and we answer with a pong nudge — that traffic
// is also what keeps this MV3 worker alive inside Chrome's 30s idle window
// while a panel is up.

const PAIR_DNR_RULE_ID = 7301;
const PAIR_REPLIES_KEPT = 20;
const PAIR_RELAY_KEPT = 40;
const PAIR_TIMELINE_KEPT = 30;

let pairSock = null;
let pairSockSession = 0;
let pairRetryAt = 0;
let pairBackoffMs = 2000;
// The SW-side mirror of everything the panel renders, rebuilt from frames —
// a freshly injected page pulls it whole (vt-pair-panel / vt-status) instead
// of waiting for the next frame. Session-keyed like pairLastState.
let pairPanel = null;

function resetPairPanel(sessionId) {
  pairPanel = { sessionId, board: "", listening: false, working: null,
    items: [], replies: {}, timeline: {}, relay: [], wsUp: false };
}
function pairPanelFor(rec) {
  // A session the server has disowned (rec.dead) has no live pair surface —
  // reads return nothing and, through pairItemKnown, writes authorize nothing
  // (r3889185777).
  if (!rec || rec.dead || !pairPanel || pairPanel.sessionId !== rec.sessionId) return null;
  return pairPanel;
}
function pairSockOpen() {
  return !!pairSock && pairSock.readyState === WebSocket.OPEN;
}

function pushTimeline(id, status) {
  const tl = pairPanel.timeline[id] || (pairPanel.timeline[id] = []);
  if (tl.length && tl[tl.length - 1].status === status) return;
  tl.push({ status, at: new Date().toISOString() });
  if (tl.length > PAIR_TIMELINE_KEPT) tl.shift();
}

function applyPairFrame(f) {
  if (!pairPanel) return;
  switch (f.type) {
    case "hello":
      pairPanel.board = f.board || "";
      pairPanel.listening = !!f.listening;
      pairPanel.working = f.working || null;
      break;
    case "items":
      pairPanel.items = f.items || [];
      for (const it of pairPanel.items) pushTimeline(it.id, it.status);
      break;
    case "item": {
      const it = f.item;
      if (!it) return;
      const i = pairPanel.items.findIndex((x) => x.id === it.id);
      if (i >= 0) pairPanel.items[i] = it; else pairPanel.items.push(it);
      pushTimeline(it.id, it.status);
      break;
    }
    case "status": {
      const it = pairPanel.items.find((x) => x.id === f.id);
      if (it) it.status = f.status;
      pushTimeline(f.id, f.status);
      break;
    }
    case "reply": {
      const list = pairPanel.replies[f.id] || (pairPanel.replies[f.id] = []);
      list.push(f.message);
      if (list.length > PAIR_REPLIES_KEPT) list.shift();
      break;
    }
    case "working":
      pairPanel.working = f.status ? { status: f.status, actor: f.actor } : null;
      break;
    case "listening":
      pairPanel.listening = !!f.listening;
      break;
    case "relay":
      pairPanel.relay.push({ text: f.text, ts: f.ts });
      if (pairPanel.relay.length > PAIR_RELAY_KEPT) pairPanel.relay.shift();
      break;
  }
}

async function broadcastPairFrame(frame) {
  const rec = await getState();
  if (!rec || rec.sessionId !== pairSockSession) return;
  for (const tabId of Object.keys(rec.tabs || {})) {
    chrome.tabs.sendMessage(Number(tabId), { type: "vt-pair-frame", frame }).catch(() => {});
  }
}

// ensureWSAuthHeader installs the session DNR rule that authenticates the
// websocket handshake. Best-effort: without it the handshake is refused
// server-side and the panel simply stays on the poll fallback.
async function ensureWSAuthHeader() {
  const { base, workspace: configWorkspace, token } = await getConfig();
  const workspace = await activeWorkspace(configWorkspace);
  if (!base || !token || !chrome.declarativeNetRequest) return false;
  // Left-anchored to the FULL configured origin — scheme, host AND port
  // (requestDomains matches domains only and silently dropped the port, so a
  // token for host:8443 could ride to other ports of the same host;
  // r3886550909). "|" is DNR's left anchor.
  const origin = new URL(base).origin;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [PAIR_DNR_RULE_ID],
    addRules: [{
      id: PAIR_DNR_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        // A browser WebSocket carries neither header, so BOTH the credential
        // and the tenant it acts in have to be stamped here — a handshake
        // authenticated but unaddressed is refused exactly like an
        // unauthenticated one once the account has several memberships.
        requestHeaders: [
          { header: "Authorization", operation: "set", value: `Bearer ${token}` },
          ...(workspace ? [{ header: WORKSPACE_HEADER, operation: "set", value: workspace }] : []),
        ],
      },
      condition: {
        urlFilter: "|" + origin + "/api/v1/sessions/",
        resourceTypes: ["websocket"],
      },
    }],
  });
  return true;
}

async function connectPairWS() {
  const rec = await getState();
  if (!rec || rec.dead || rec.stopping || !rec.sessionId) return;
  if (pairSock && pairSockSession === rec.sessionId &&
      (pairSock.readyState === WebSocket.OPEN || pairSock.readyState === WebSocket.CONNECTING)) return;
  if (Date.now() < pairRetryAt) return;
  const { base } = await getConfig();
  if (!base) return;
  try {
    if (!(await ensureWSAuthHeader())) return; // no token/DNR — poll fallback carries the line
  } catch (e) {
    console.warn("vitrinka: pair ws auth rule failed — staying on the poll", e);
    return;
  }
  closePairWS();
  if (!pairPanel || pairPanel.sessionId !== rec.sessionId) resetPairPanel(rec.sessionId);
  let sock;
  try {
    sock = new WebSocket(base.replace(/^http/, "ws") + `/api/v1/sessions/${rec.sessionId}/pair/ws`);
  } catch (e) {
    pairRetryAt = Date.now() + pairBackoffMs;
    pairBackoffMs = Math.min(pairBackoffMs * 2, 30_000);
    console.warn("vitrinka: pair ws connect failed", e);
    return;
  }
  pairSock = sock;
  pairSockSession = rec.sessionId;
  sock.onopen = () => {
    pairBackoffMs = 2000;
    if (pairPanel) pairPanel.wsUp = true;
    broadcastPairFrame({ type: "ws", up: true });
  };
  sock.onmessage = (ev) => {
    // A frame already queued when the socket was dropped must not repopulate
    // the panel we just cleared — same ownership check onclose makes
    // (r3889185777).
    if (pairSock !== sock) return;
    let f;
    try { f = JSON.parse(ev.data); } catch { return; }
    if (f.type === "ping") {
      try { sock.send(`{"type":"pong"}`); } catch { /* close handles it */ }
      return;
    }
    applyPairFrame(f);
    broadcastPairFrame(f);
  };
  sock.onclose = () => {
    if (pairSock !== sock) return;
    pairSock = null;
    if (pairPanel) pairPanel.wsUp = false;
    pairRetryAt = Date.now() + pairBackoffMs;
    pairBackoffMs = Math.min(pairBackoffMs * 2, 30_000);
    broadcastPairFrame({ type: "ws", up: false });
  };
  sock.onerror = () => { /* onclose follows and owns the backoff */ };
}

function closePairWS() {
  if (!pairSock) return;
  const sock = pairSock;
  pairSock = null;
  // Detach EVERYTHING before closing: a live onmessage on a closed socket can
  // still deliver an in-flight frame into applyPairFrame (r3889185777).
  try {
    sock.onmessage = null;
    sock.onopen = null;
    sock.onerror = null;
    sock.onclose = null;
    sock.close();
  } catch { /* already dead */ }
  if (pairPanel) pairPanel.wsUp = false;
}

// pairWriteKey mints the retry-safe identity of one panel-born item.
// pairItemKnown answers whether id is one of THIS session's pair items per
// the worker's own authenticated state (see the shadow-root caveat above).
// It takes `rec` and reads through pairPanelFor so the cache is checked
// SESSION-KEYED like every other panel read: a panel left over from a
// stopped/dead/previous session must never authorize a write, or the guard
// would spend the credential on the old session's annotation ids
// (r3886925281).
function pairItemKnown(rec, id) {
  const panel = pairPanelFor(rec);
  const n = Number(id);
  return !!(panel && Array.isArray(panel.items) && panel.items.some((i) => i.id === n));
}

function pairWriteKey() {
  return (crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
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

// Recorder attachments (2026-10-09 decisions): the images a tester attached
// to a note or a ⌖ annotation. What /shot accepts, and the server's per-note
// ceiling (it ignores the rest; the HUD itself stops at 4).
const ATTACHMENT_TYPES = new Set(["image/png", "image/webp", "image/jpeg"]);
const MAX_NOTE_ATTACHMENTS = 10;

// attachmentsOf turns the content script's data URLs (runtime messages are
// JSON — a Blob would arrive as {}) back into Blobs, keeping only what the
// /shot leaf can ever take: anything else is a permanent 4xx after an upload.
// The HUD already re-encoded them; tester images are never pixel-masked (D2 —
// the workspace's lever is the `attachments` switch, not shoot()'s blur).
async function attachmentsOf(list) {
  if (!Array.isArray(list)) return [];
  const dim = (n) => (Number.isInteger(n) && n > 0 ? n : undefined);
  const out = [];
  for (const a of list.slice(0, MAX_NOTE_ATTACHMENTS)) {
    if (!a || typeof a.dataUrl !== "string" || !a.dataUrl.startsWith("data:image/")) continue;
    let blob;
    try {
      blob = await (await fetch(a.dataUrl)).blob();
    } catch (e) {
      console.warn("vitrinka: attachment undecodable — dropped", String(e));
      continue;
    }
    if (!ATTACHMENT_TYPES.has(blob.type) || !blob.size || blob.size > WIRE_ITEM_CAP) {
      console.warn(`vitrinka: attachment (${blob.type || "no type"}, ${blob.size} B) is not an image /shot takes — dropped`);
      continue;
    }
    out.push({ name: String(a.name || "image").slice(0, 200), blob, w: dim(a.w), h: dim(a.h) });
  }
  return out;
}

// pushNote queues a note with its attachments. Each image is an `attachment`
// event whose bytes upload through /shot first and whose seq is drawn BEFORE
// the note's, so the note's `attachments: [seqs]` names events a replay has
// already seen. Images reach the queue only while the recording's policy
// answered `attachments: true`; a note left with neither text nor images (and
// no other reason to exist — `keep`) is not written.
//
// `startedIn` is the recording the message arrived in, read BEFORE its images
// decoded: a stop → start landing meanwhile must not file the note — or the
// tab lane it resolves — into the next recording. Unlike pushEvents, the
// write happens INSIDE the lock and as one transaction: the images and their
// note land together or not at all, and Stop's freeze (which takes this lock)
// only reaches its drain once they are on disk.
async function pushNote(startedIn, tabId, payload, files, keep) {
  const queued = await withLock(async () => {
    const cur = await getState();
    if (!capturing(cur) || !sameRecording(cur, startedIn)) return false;
    const tab = cur.tabs[String(tabId)];
    if (!tab) return false;
    const imgs = cur.attachments === true ? files : [];
    if (files.length > imgs.length) console.warn(`vitrinka: ${files.length} attachment(s) dropped — the workspace does not take them`);
    if (!imgs.length && !keep) return false;
    const first = cur.seq + 1;
    cur.seq += imgs.length + 1;
    // Seqs persist first: a worker killed before the batch commits leaves a
    // hole, never a later capture overwriting rows that did land.
    await setState(cur);
    const ts = new Date().toISOString();
    const seqs = imgs.map((_, i) => first + i);
    await vtdb.putAll([
      ...imgs.map(({ name, blob, w, h }, i) => ({
        sessionId: cur.sessionId, seq: seqs[i], ts, tabId: tab.id, tabHost: tab.host, kind: "attachment",
        payload: { name, mime: blob.type, bytes: blob.size, ...(w ? { w } : {}), ...(h ? { h } : {}) },
        blob, blobCT: blob.type,
      })),
      {
        sessionId: cur.sessionId, seq: cur.seq, ts, tabId: tab.id, tabHost: tab.host, kind: "note",
        payload: seqs.length ? { ...payload, attachments: seqs } : payload,
      },
    ]);
    return true;
  });
  if (queued) scheduleFlush();
}

// Allocate `count` consecutive seqs without emitting events (blob uploads name
// their blobs by seq). Returns {seq, sessionId} — the pair, atomically: a seq
// only means anything alongside the session it was drawn from, and a caller
// that awaits between allocating and writing (shoot() encodes a PNG in that
// gap) must not have its item re-attributed to a session that started
// meanwhile. Multi-part rrweb batches reserve their whole range in this one
// lock, so a concurrent handler can never interleave into it.
function allocSeq(count = 1, expected = null) {
  return withLock(async () => {
    const rec = await getState();
    if (!rec || (expected && (!capturing(rec) || !sameRecording(rec, expected)))) return null;
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

  // Phase 1 — blobs. A shot/attachment/rrweb item owes its bytes before its
  // event row can reference them, and each is its own request. FIFO is strict:
  // a transient failure stops the pass rather than reordering the stream.
  for (const item of live) {
    if (!item.needsBlob) continue;
    // Every image rides the /shot leaf — a tester's attachment too (recorder
    // attachments D5: zero vkr_ widening, and an older server stores the blob
    // and ignores the event); only rrweb JSON is a /chunk.
    const leaf = item.kind === "shot" || item.kind === "attachment" ? "shot" : "chunk";
    const path = `/api/v1/sessions/${rec.sessionId}/${leaf}?seq=${item.seq}`;
    try {
      const up = await api("POST", path, item.blob, item.blobCT);
      await vtdb.resolveBlob(rec.sessionId, item.seq, up.blobKey);
      item.blobKey = up.blobKey;
      item.needsBlob = 0;
      noteSync();
    } catch (e) {
      const st = statusOf(e);
      if (st === 401 || st === 403) {
        // A verdict on the CREDENTIAL, never on this item: the token was
        // revoked, or it is not the one that started this session (a re-link
        // mid-session — the server answers 403 for a session another
        // credential started). Keep every queued item, same as phase 2's
        // terminal verdict; only the reaper's 404/done may discard them.
        await markSessionDead(rec, `server refused this recorder for the session (${st})`);
        return false;
      }
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
      await markSessionDead(rec, `server rejected this session (${st})`);
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
async function markSessionDead(expected, reason) {
  await withLock(async () => {
    const rec = await getState();
    // A previous upload/reconcile can finish after Start adopted another
    // session. Apply its verdict only to the session named in that request.
    if (!sameRecording(rec, expected) || rec.dead) return;
    rec.dead = true;
    rec.deadReason = reason;
    await setState(rec);
    closePairWS();
    resetPairPanel(rec.sessionId);
    console.warn("vitrinka: session marked dead —", reason);
    await badge("dead");
    await broadcastHealth();
  });
}

// ---------------------------------------------------------------------------
// server reconciliation + dead-session reaping (D5/D9)

// reconcile asks the server what it actually holds. Two answers matter: the
// maxSeq the HUD reconciles against, and whether the session still exists at
// all. Only the SERVER's verdict may declare local data reapable.
async function reconcile() {
  const rec = await getState();
  if (!rec) return null;
  // A SW death between session start and the policy fetch landing leaves
  // rec.policy undefined forever (the promise died with the worker) — the
  // reconcile poll is the natural retry heartbeat. undefined strictly means
  // "no answer yet"; a completed-but-failed fetch stored null (defaults are
  // then final). Single-flight so overlapping polls don't stack fetches.
  if (rec.policy === undefined && !policyRefetchInFlight && !pendingPolicy) {
    // !pendingPolicy: the start-path fetch may still be in flight — starting
    // a second fetch would bump policyRunSeq and discard the first apply
    // (converges, but wastefully).
    policyRefetchInFlight = true;
    const caps = {};
    applyPolicyWhenFetched(
      fetchPolicy(rec.workspace || "", caps).finally(() => { policyRefetchInFlight = false; }),
      rec, null, caps,
    );
  }
  let ses;
  try {
    ses = await api("GET", `/api/v1/sessions/${rec.sessionId}`);
  } catch (e) {
    if (statusOf(e) === 404) {
      await markSessionDead(rec, "session no longer exists on the server");
      return null;
    }
    noteFailure(e);
    return null;
  }
  const active = await withLock(async () => {
    const current = await getState();
    if (!sameRecording(current, rec)) return null;
    serverMaxSeq = Number(ses.maxSeq || 0);
    if (ses.boardUrl) liveBoard = { sessionId: current.sessionId, url: ses.boardUrl };
    return current;
  });
  if (!active) return null;
  if (!active.stopping && (ses.status === "done" || ses.deletedAt)) {
    await markSessionDead(rec, ses.deletedAt ? "session was deleted" : "session was closed on the server");
  }
  await broadcastHealth();
  return ses;
}

// reapDeadSessions clears queue data for sessions the server considers gone.
// LIVE data is never touched (D8/D9): the only thing that authorizes a delete
// is the server saying done / deleted / 404 for that exact session id — asked
// of the base and workspace it was recorded into (queueScope), since another
// server's or workspace's #N answering 404 says nothing about this one.
const QUEUE_SCOPE = "queueScope:";

// The queue itself is keyed by session id alone (db.js [sessionId, seq]), so
// recording #N while another scope's #N still has an undelivered tail would
// mix the two and upload that tail into this session — another server's or
// workspace's data. Refused before adopting the id; the tail keeps its scope.
async function refuseForeignTail(sessionId, scope) {
  const prior = (await chrome.storage.local.get(QUEUE_SCOPE + sessionId))[QUEUE_SCOPE + sessionId];
  if (!prior || scopeKey(prior, sessionId) === scopeKey(scope, sessionId)) return;
  if (!(await vtdb.sessionStats(sessionId)).count) return;
  throw new Error(`session #${sessionId} collides with an undelivered tail of #${sessionId} recorded on ${prior.base}`
    + `${prior.workspace ? ` in ${prior.workspace}` : ""} — switch Settings back to finish it there, or use Recorder data → Clear all`);
}

// A marker is gone once neither the queue nor the rec holds its session.
// Candidates come from the reaper's queue snapshot, read without the lock (a
// full scan, the queue is unbounded, must never stall capture); each is then
// rechecked under the lock Start/Continue adopt a marker + rec with, by the
// live rec and a one-record queue read. A marker written after the snapshot
// is never a candidate.
async function pruneQueueScopes(st) {
  const stored = await chrome.storage.local.get(null);
  const candidates = Object.keys(stored).filter((k) => k.startsWith(QUEUE_SCOPE) && !st.bySession[k.slice(QUEUE_SCOPE.length)]);
  if (!candidates.length) return;
  await withLock(async () => {
    const rec = await getState();
    const gone = [];
    for (const k of candidates) {
      const id = k.slice(QUEUE_SCOPE.length);
      if (rec && String(rec.sessionId) === id) continue;
      if ((await vtdb.head(Number(id), 1)).length) continue; // queued since the snapshot
      gone.push(k);
    }
    if (gone.length) await chrome.storage.local.remove(gone);
  });
}

async function reapDeadSessions() {
  // A failed read proves nothing about what is queued: decide (and prune) nothing.
  const st = await vtdb.stats().catch(() => null);
  if (!st) return;
  await pruneQueueScopes(st);
  const rec = await getState();
  const stored = await chrome.storage.local.get(null);
  if (!st.count) return;
  const { base } = await getConfig();
  for (const key of Object.keys(st.bySession)) {
    const sessionId = Number(key);
    if (!sessionId) continue;
    if (rec && rec.sessionId === sessionId && !rec.dead) continue; // the live one
    // A tail queued before 0.9.1 names no scope: asked as before, of the
    // configured server in the active workspace.
    const scope = stored[QUEUE_SCOPE + key] || null;
    if (scope && scope.base !== base) continue; // another server's — this token cannot ask
    let dead = false;
    try {
      const ses = await api("GET", `/api/v1/sessions/${sessionId}`, undefined, undefined, scope ? { base: scope.base, workspace: scope.workspace } : {});
      dead = ses.status === "done" || !!ses.deletedAt;
    } catch (e) {
      if (statusOf(e) === 404) dead = true;
      else continue; // server unreachable — decide nothing, try again later
    }
    if (!dead) continue;
    await withLock(async () => {
      const current = await getState();
      // A done response obtained before Continue cannot reap its reopened tail.
      if (current?.sessionId === sessionId && (!current.dead || !sameRecording(current, rec))) return;
      const n = await vtdb.dropSession(sessionId);
      console.warn(`vitrinka: reaped ${n} item(s) of finished session ${sessionId}`);
      if (!sameRecording(current, rec) || current.sessionId !== sessionId) return;
      await setState(null);
      await badge("off");
    });
  }
}

// ---------------------------------------------------------------------------
// tab attachment: content script + CDP

// What a recorded tab runs, in order: the manifest icons (the pair panel),
// rrweb, the shared HUD (`@vitrinka/web`'s hud.iife.js, vendored by
// tools/vendor-hud) and the content script that mounts it.
const CONTENT_FILES = ["vendor/vitrinka-icons.js", "vendor/rrweb-record.min.js", "vendor/vitrinka-hud.iife.js", "content.js"];

async function tabInfo(tabId) {
  const rec = await getState();
  return rec && rec.tabs && rec.tabs[String(tabId)];
}

async function attachTab(tabId, url) {
  const recording = await getState();
  if (!recording || recording.tabs[String(tabId)]) return;
  let host = "";
  try { host = new URL(url).host; } catch { return; }
  if (!host || !/^https?:/.test(url)) return;
  const rec = await withLock(async () => {
    const current = await getState();
    if (!sameRecording(current, recording) || current.tabs[String(tabId)]) return null;
    current.nextTab = (current.nextTab || 0) + 1; // monotonic: lane ids never reused after tab close
    current.tabs[String(tabId)] = { id: `tab${current.nextTab}`, host, cdp: false };
    await setState(current);
    return current;
  });
  if (!rec) return;
  const laneId = rec.tabs[String(tabId)].id;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
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
    await withLock(async () => {
      const current = await getState();
      if (!sameRecording(current, rec) || current.tabs[String(tabId)]?.id !== laneId) return;
      current.tabs[String(tabId)].cdp = true;
      await setState(current);
    });
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

// ---------------------------------------------------------------------------
// redaction (SaaS data-security decision #2) — the shared @vitrinka/redact
// engine (vendor/redact.js, generated from packages/redact).
//
// Safe-by-default capture-side scrubbing, mirroring the server's ingest
// engine: auth-bearing header VALUES, known-sensitive JSON/form body keys and
// URL query/fragment secrets never leave the machine. The workspace policy
// (GET /api/v1/recorder/policy, fetched at session start, riding in `rec` so
// every SW wake has it) adds extra names, regex patterns, and — self-host
// only — the fullFidelity escape hatch. The server re-applies the same policy
// at ingest as the backstop; this side is defense in depth + smaller stored
// payloads. Fail CLOSED: no policy (fetch failed, old server) means the
// engine defaults, never capture-everything.

// Compiled rules for a rec's policy (the engine caches by policy identity).
function rulesOf(rec) {
  return vtRedact.compileRules((rec && rec.policy) || null);
}

// redactUrl scrubs sensitive query/fragment parameter values from a URL
// before it is stored — OAuth callbacks, magic links, SAS URLs. Benign URLs
// pass through byte-identical.
function redactUrl(rec, raw) {
  return vtRedact.redactUrl(rulesOf(rec), raw || "");
}

// redactBodyCapped scrubs one request/response body and caps it to BODY_CAP
// in the engine's shape-aware ORDER (REDACTION-SPEC §Bodies): JSON redacts
// WHOLE then caps — slicing first would downgrade exactly the payloads most
// likely to carry credentials to the weaker truncation fallback. Form-encoded
// and multipart bodies scrub key-wise; everything else gets the text pass.
function redactBodyCapped(rec, body, contentType) {
  return vtRedact.redactAndCap(rulesOf(rec), body || "", BODY_CAP, contentType || "");
}

// headerCT extracts a content-type from a raw CDP header map ("" if absent).
function headerCT(h) {
  for (const k of Object.keys(h || {})) {
    if (k.toLowerCase().replace(/[-_]/g, "") === "contenttype") return String(h[k]);
  }
  return "";
}

// Headers ride along capped (D2 "all headers") and REDACTED: sensitive names
// lose their value before anything is stored; individual values bounded,
// total budget ~8 KiB per side so one giant cookie can't bloat the event.
function capHeaders(h, rec) {
  if (!h) return undefined;
  return vtRedact.redactHeaders(rulesOf(rec), h);
}

// fetchPolicy pulls the workspace redaction policy at session start. Full
// fidelity only ever arrives as an explicit, validated server-approved flag.
// fetchPolicy resolves to THREE distinct states — never conflate them,
// because the engine's DOM/pixel defaults are PERMISSIVE and resolving
// "unknown" to them fails open:
//   policy object / null  — the server ANSWERED (2xx, or a deliberate 4xx =
//                           no policy / request refused): defaults are FINAL.
//   undefined             — UNKNOWN (timeout, network error, 5xx): rec.policy
//                           stays unset, waiters answer STRICT, shoot() keeps
//                           dropping, and the reconcile poll retries.
// BOUNDED (10s): a hung endpoint must not pin pendingPolicy — and with it
// every vt-policy/shoot waiter — for the session's lifetime. (No extra
// rejection guard needed: Promise.race subscribes to every input, so the
// abandoned request's late rejection is always handled.)
// `caps`, when passed, receives what the same answer carries beside the
// policy — `attachments` (recorder attachments D6: `true` shows the HUD's
// paperclip; absent on an older server or `false` when the workspace switched
// them off) — set only once the server has answered, like the policy itself.
async function fetchPolicy(workspace, caps = null) {
  try {
    const res = await Promise.race([
      api("GET", "/api/v1/recorder/policy", undefined, undefined, { workspace }),
      new Promise((_res, rej) =>
        setTimeout(() => rej(new Error("policy fetch timed out")), 10_000)),
    ]);
    // A 2xx WITHOUT the policy envelope (204, proxy-stripped body) is
    // out-of-contract — UNKNOWN, not "no policy": the real endpoint always
    // carries a `policy` key, even for the zero policy.
    if (!res || typeof res !== "object" || Array.isArray(res) || !("policy" in res)) return undefined;
    const policy = res.policy;
    const settled = (answer) => {
      if (caps) caps.attachments = res.attachments === true;
      return answer;
    };
    if (policy === null) return settled(null);
    // A malformed answer must stay UNKNOWN: settling it could reopen DOM or
    // pixels, or persist rules the engine cannot compile and suppress retries.
    // Unknown fields remain forward-compatible; recognized fields are typed.
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) return undefined;
    for (const key of ["extraHeaders", "extraBodyKeys", "patterns"]) {
      if (key in policy && (!Array.isArray(policy[key]) || !policy[key].every((value) => typeof value === "string"))) return undefined;
    }
    for (const key of ["maskAllText", "fullFidelity"]) {
      if (key in policy && typeof policy[key] !== "boolean") return undefined;
    }
    return settled(policy);
  } catch (e) {
    const status = statusOf(e);
    // permanentStatus = 4xx minus 408/429: a rate-limited or proxy-timed-out
    // GET is TRANSIENT — settling it would reopen the fail-open this tri-state
    // exists to close (401/403 stay permanent deliberately: a dead token kills
    // the uploads through the same api(), so the session is dying regardless).
    if (permanentStatus(status)) {
      console.warn("vitrinka: no redaction policy (HTTP " + status + ") — using safe defaults", e);
      if (caps) caps.attachments = false;
      return null;
    }
    console.warn("vitrinka: redaction policy fetch failed — strict masking until the retry lands", e);
    return undefined;
  }
}

// applyPolicyWhenFetched patches the fetched policy into rec once it lands —
// only while the SAME run is live and no answer settled meanwhile — then
// pushes the pixel policy to every attached tab (a surviving content-script
// instance keeps module state across sessions). Never blocks session start
// (REDACTION-SPEC "Fail closed": the KEY/URL defaults capture until the
// policy lands; the DOM/pixel directives wait via awaitPolicySettled below,
// because THEIR default is the permissive side).
let policyRefetchInFlight = false;
// The in-flight fetch, exposed so vt-policy/shoot can wait on it bounded.
let pendingPolicy = null;
// Monotonic run counter: a stale promise from run A must not outrace run B's
// fresher answer even when both runs carry the SAME server session id
// (stop → continue of one session). `caps` is the object fetchPolicy filled
// beside the policy; its `attachments` is written in the same state write.
let policyRunSeq = 0;
function applyPolicyWhenFetched(policyPromise, recording, tabId, caps = null) {
  const runSeq = ++policyRunSeq;
  // pendingPolicy holds the WHOLE CHAIN (fetch + the setState that persists
  // it), never the raw fetch promise: a waiter racing the raw promise would
  // resume and re-read storage BEFORE the apply's write committed, observe
  // policy === undefined on a fetch that just succeeded, and take the strict
  // path on a perfectly healthy backend.
  const chain = policyPromise.then(async (policy) => {
    if (runSeq !== policyRunSeq) return; // a newer run superseded this fetch
    // UNKNOWN outcome (timeout/network/5xx): let the chain settle — which
    // unpins pendingPolicy so waiters stop hanging — but write NOTHING:
    // rec.policy stays undefined, waiters stay strict, reconcile retries.
    if (policy === undefined) return;
    // The read-modify-write rides withLock like every other state writer —
    // an unserialized apply could interleave with attachTab/pushEvents,
    // whose stale rec (policy still undefined) would commit AFTER this write
    // and erase the fetched policy.
    const attachments = !!caps && caps.attachments === true;
    const rec = await withLock(async () => {
      const live = await getState();
      if (!sameRecording(live, recording) || live.policy !== undefined) return null;
      await setState({ ...live, policy, attachments });
      return live;
    });
    if (!rec) return;
    // Push to the explicit tab AND every attached tab — the reconcile retry
    // has no single "active" tab, and surviving instances all need the flip.
    const pixel = vtRedact.pixelPolicy(vtRedact.compileRules(policy || null));
    const ids = new Set(Object.keys(rec.tabs || {}).map(Number));
    if (tabId != null) ids.add(tabId);
    for (const id of ids) {
      chrome.tabs.sendMessage(id, { type: "vt-policy-push", pixel }).catch(() => {});
    }
    // canAttach rides hudState; a HUD that mounted before the answer landed
    // learns of its paperclip here (a later mount reads it with vt-hud).
    if (attachments) broadcastHud().catch((e) => console.warn("vitrinka: HUD broadcast failed", e));
  }).catch((e) => { console.warn("vitrinka: redaction policy apply failed — keeping strict masking", e); });
  pendingPolicy = chain;
  chain.finally(() => {
    if (pendingPolicy === chain) pendingPolicy = null;
  });
}

// Bounded wait for the in-flight policy. Returns the FRESH rec afterwards;
// callers whose safe default is the PERMISSIVE side (rrweb text masking,
// screenshot blur) must not act on an unsettled state.
async function awaitPolicySettled(ms) {
  if (pendingPolicy) {
    await Promise.race([pendingPolicy, new Promise((res) => setTimeout(res, ms))]);
  }
  return getState();
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
  // Console/exception text is the classic secret side-channel: an app's
  // fetch wrapper logging `login failed <url>?access_token=… {"refresh_token"…}`
  // would bypass the body/URL scrubs entirely — run the engine's text pass
  // (URL params, auth headers, JWTs, key=value pairs) before buffering, the
  // same as the Expo client's console capture.
  if (method === "Runtime.consoleAPICalled" && params.type === "error") {
    const raw = (params.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: {
      level: "error",
      text: (vtRedact.redactText(rulesOf(rec), raw) || "").slice(0, 500),
    } }]);
    return;
  }
  if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    const raw = (d.exception && (d.exception.description || d.exception.value)) || d.text || "uncaught exception";
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: {
      level: "error",
      text: (vtRedact.redactText(rulesOf(rec), String(raw)) || "").slice(0, 500),
    } }]);
    return;
  }
  if (method === "Network.webSocketCreated") {
    // WS visibility (D2): connection-level capture; frame capture is a
    // documented follow-up (README known limits).
    await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "request", payload: {
      method: "WS", url: redactUrl(rec, params.url), status: 101, type: "WebSocket",
    } }]);
    return;
  }
  const key = `${source.tabId}:${source.sessionId || ""}:${params.requestId}`;
  if (method === "Network.requestWillBeSent") {
    const r = params.request;
    inflight.set(key, {
      method: r.method, url: redactUrl(rec, r.url),
      reqBody: redactBodyCapped(rec, r.postData || "", headerCT(r.headers)),
      reqHeaders: capHeaders(r.headers, rec),
      start: params.timestamp, type: params.type, sessionId: source.sessionId,
    });
  } else if (method === "Network.responseReceived") {
    const f = inflight.get(key);
    if (f) {
      f.status = params.response.status; f.mime = params.response.mimeType; f.type = params.type;
      // The FULL Content-Type, boundary included — mimeType alone strips the
      // parameters, and multipart redaction dispatches on the boundary.
      f.resCT = headerCT(params.response.headers);
      f.resHeaders = capHeaders(params.response.headers, rec);
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
        resBody = redactBodyCapped(rec, b.base64Encoded ? "" : b.body || "", f.resCT || f.mime || "");
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
  const recording = await getState();
  const laneId = recording?.tabs[String(source.tabId)]?.id;
  if (!laneId) return;
  await withLock(async () => {
    const current = await getState();
    if (!sameRecording(current, recording) || current.tabs[String(source.tabId)]?.id !== laneId) return;
    current.tabs[String(source.tabId)].cdp = false;
    await setState(current);
  });
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

// `expected`, when passed, is the recording a deliberate snap was asked in:
// one that ended while the snap's message was handled shoots nothing.
async function shoot(tabId, payload, expected = null) {
  let rec = await getState();
  if (!capturing(rec) || (expected && !sameRecording(rec, expected))) return;
  // A frame captured before the policy settles could be a full-resolution
  // shot of a workspace that demanded blur (maskAllText's default is the
  // permissive side). Wait bounded; still unsettled ⇒ drop the frame — the
  // same fail-closed spirit as the blur-failure drop below.
  if (rec.policy === undefined) {
    const expected = rec;
    rec = await awaitPolicySettled(2000);
    if (!capturing(rec) || !sameRecording(rec, expected) || rec.policy === undefined) return;
  }
  const tab = rec.tabs[String(tabId)];
  if (!tab) return;
  // The tab URL can be an OAuth callback / magic link — same query-secret
  // scrub as recorded network URLs, for every shoot() call site at once.
  if (payload && payload.url) payload = { ...payload, url: redactUrl(rec, payload.url) };
  // The session this frame belongs to, fixed BEFORE the capture awaits below
  // (review r3650595572): a stop — or a stop followed by a start — completing
  // during them would otherwise file these pixels into whatever session is
  // live when the encode finishes.
  const startedIn = rec;
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
  // Native Blob into the queue — no base64 dataURL sitting on disk (D7).
  let blob = await (await fetch(dataURL)).blob();
  // Pixel masking (maskAllText ⇒ blur): screenshots carry real rendered
  // text — downscale until text is unreadable while layout survives,
  // mirroring the Expo client's blurred keyframes. FAIL CLOSED: if the
  // downscale fails, a masked workspace gets no frame rather than raw
  // pixels. Runs BEFORE the dedup-hash write and the seq allocation, so a
  // dropped frame neither burns a seq (a hole in the ordinal stream) nor
  // poisons the dedup cache (the NEXT capture of this unchanged screen must
  // still land).
  if (vtRedact.pixelPolicy(rulesOf(rec)) === "blur") {
    let bmp;
    try {
      bmp = await createImageBitmap(blob);
      const w = 96, h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
      const cv = new OffscreenCanvas(w, h);
      cv.getContext("2d").drawImage(bmp, 0, 0, w, h);
      blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    } catch (e) {
      console.warn("vitrinka: shot blur failed — frame dropped (maskAllText)", String(e));
      return;
    } finally {
      if (bmp) bmp.close();
    }
  }
  // Allocate only while the SAME generation is still capturing: Stop→Continue
  // reuses the server id, but must never adopt pixels from its earlier policy.
  const alloc = await allocSeq(1, startedIn);
  if (!alloc) return;
  lastShotHash.set(String(tabId), hash);
  await enqueue({
    sessionId: alloc.sessionId, seq: alloc.seq,
    ts: new Date().toISOString(), tabId: tab.id, tabHost: tab.host,
    // blobCT is the literal upload Content-Type — it must describe the BLOB
    // (JPEG after the blur path), never assume the capture format.
    kind: "shot", payload, blob, blobCT: blob.type || "image/png",
  });
}

// ---------------------------------------------------------------------------
// lifecycle

async function startSession(title) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active || !/^https?:/.test(active.url || "")) throw new Error("open the app you want to record first");
  const host = new URL(active.url).host;
  // Which workspace records this host? The apex door searches every
  // membership's project rules (recorder_resolve.go); the options page's
  // workspace, when set, pins the search to that one. A 404 there means the
  // older single-tenant server has no such door — fall through and let the
  // tenant door resolve inside the configured workspace as before.
  let workspace = (await getConfig()).workspace;
  try {
    const hit = await api("GET", `/api/v1/recorder/resolve?host=${encodeURIComponent(host)}`, undefined, undefined, { workspace });
    if (hit && hit.workspace) workspace = hit.workspace;
  } catch (e) {
    const m = /→ (\d{3}): (.*)$/s.exec(String(e && e.message));
    if (!m || (m[1] !== "404" && m[1] !== "405")) throw e;
    let code = "";
    try { code = JSON.parse(m[2]).code || ""; } catch { /* not json */ }
    if (code === "no_host_rule") throw new Error(`no project claims ${host} in any of your workspaces — add it to a project's domains first`);
  }
  const ses = await api("POST", "/api/v1/sessions", {
    host, title: title || "", meta: { userAgent: navigator.userAgent, recorder: "extension/" + chrome.runtime.getManifest().version },
  }, undefined, { workspace });
  // Pin the resolved tenant before fetching its policy or adopting its queue.
  workspace = ses.workspace || workspace;
  const scope = await scopeOf(workspace);
  try {
    await refuseForeignTail(ses.id, scope);
  } catch (e) {
    await api("PATCH", `/api/v1/sessions/${ses.id}`, { status: "done" }, undefined, { workspace }).catch(() => {});
    throw e;
  }
  // A slow policy never blocks adoption: DOM stays strictly masked and shots
  // wait/drop until its asynchronous answer settles for this generation.
  const recording = {
    generation: crypto.randomUUID(),
    sessionId: ses.id, project: ses.project, environment: ses.environment, workspace,
    title: ses.title, startedAt: ses.startedAt, seq: 0, paused: false, tabs: {},
    activeMs: 0, resumeAt: new Date().toISOString(),
  };
  await withLock(async () => {
    await chrome.storage.local.set({ [QUEUE_SCOPE + ses.id]: scope });
    await setState(recording);
  });
  const caps = {};
  applyPolicyWhenFetched(fetchPolicy(workspace, caps), recording, active.id, caps);
  serverMaxSeq = 0;
  lastSyncAt = Date.now();
  failures = 0;
  lastError = "";
  wrapping = null;
  liveBoard = { sessionId: ses.id, url: ses.boardUrl || "" };
  resetPairPanel(ses.id); // a new recording starts on an empty panel, not the last one's
  await noteRecent({ ...scope, sessionId: String(ses.id), title: ses.title || title || `Session #${ses.id}`, startedAt: Date.now(), status: "recording" });

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
  const scope = await scopeOf(ses.workspace);
  await refuseForeignTail(ses.id, scope);
  await api("PATCH", `/api/v1/sessions/${sessionId}`, { status: "recording" });
  // Adopt the marker and generation atomically, preserving the durable tail's
  // seq range. Policy settles asynchronously just as on a fresh Start.
  const recording = await withLock(async () => {
    await chrome.storage.local.set({ [QUEUE_SCOPE + ses.id]: scope });
    const current = await getState();
    const pending = await vtdb.sessionStats(ses.id);
    const localSeq = current?.sessionId === ses.id ? current.seq || 0 : 0;
    const next = {
      generation: crypto.randomUUID(),
      sessionId: ses.id, project: ses.project, environment: ses.environment, workspace: ses.workspace || "",
      title: ses.title, startedAt: new Date().toISOString(),
      seq: Math.max(ses.maxSeq || 0, localSeq, pending.maxSeq),
      paused: false, tabs: {}, activeMs: 0, resumeAt: new Date().toISOString(),
    };
    await setState(next);
    return next;
  });
  const caps = {};
  applyPolicyWhenFetched(fetchPolicy(recording.workspace, caps), recording, null, caps);
  serverMaxSeq = Number(ses.maxSeq || 0);
  lastSyncAt = Date.now();
  failures = 0;
  lastError = "";
  wrapping = null;
  liveBoard = { sessionId: ses.id, url: ses.boardUrl || "" };
  resetPairPanel(ses.id); // adopted session, same rule — the WS refills it
  await noteRecent({
    ...scope, sessionId: String(ses.id), title: ses.title || `Session #${ses.id}`, startedAt: Date.now(), status: "recording",
    ...(ses.boardUrl ? { boardUrl: ses.boardUrl } : {}),
  });
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
// `pill` ({tabId, token}) is the HUD instance that asked, told the link later.
async function stopSession(pill = null) {
  const rec = await withLock(async () => {
    const current = await getState();
    if (current && !current.stopping) {
      // Freeze capture atomically with Start/Continue adopting a new session.
      // `stopping` still admits detachAll's final rrweb batch, unlike paused.
      // elapsedOf stops counting once `stopping` is set, so read it first.
      current.activeMs = elapsedOf(current);
      current.stopping = true;
      await setState(current);
    }
    return current;
  });
  if (!rec) return null;
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
  await withLock(async () => {
    const current = await getState();
    if (current?.sessionId === sessionId && !sameRecording(current, rec)) return;
    await vtdb.dropSession(sessionId);
    if (!sameRecording(current, rec)) return;
    closePairWS();
    pairPanel = null; // the panel lives exactly as long as the recording
    await setState(null);
    wrapping = null;
    serverMaxSeq = -1;
    disarmReconcile();
    await badge("off");
  });
  // The device's recents (the HUD's ⋯ menu): saved with its length and the
  // server's board link, or unsaved when the server refused the close.
  const boardUrl = (done && (done.boardUrl || (done.board && done.board.url))) || "";
  const scope = await scopeOf(rec.workspace);
  await updateRecent(scope, String(sessionId), {
    status: done ? "saved" : "unsaved", durationMs: rec.activeMs || 0, ...(boardUrl ? { boardUrl } : {}),
  });
  // D3: the board is a separate, deliberate act. Watch for it to be ready and
  // tell the tester when it is — never steal focus with a tab.
  if (done) await watchForBoard(sessionId, title, done, scope, pill);
  return done;
}

function elapsedOf(rec) {
  if (!rec) return 0;
  let ms = rec.activeMs || 0;
  if (!rec.paused && !rec.stopping && rec.resumeAt) ms += Date.now() - Date.parse(rec.resumeAt);
  return ms;
}

async function togglePause() {
  // Under the rec lock like every other write: a capture's allocSeq reading
  // rec around this write used to put the old `paused` back, so the next
  // toggle paused a session the HUD had just shown resumed.
  const rec = await withLock(async () => {
    const r = await getState();
    if (!r || r.stopping) return null;
    r.paused = !r.paused;
    if (r.paused) {
      r.activeMs = (r.activeMs || 0) + (r.resumeAt ? Date.now() - Date.parse(r.resumeAt) : 0);
      r.resumeAt = null;
    } else {
      r.resumeAt = new Date().toISOString();
    }
    await setState(r);
    return r;
  });
  if (!rec) return;
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

// One wait per stop whose board is not built yet, oldest first, stored as
// `awaiting` (absent when none, so its readers stay truthiness checks):
// {sessionId, title, since, scope, pill}. The scope is the session's own —
// the rec is gone by now, and the configured base/workspace may change
// before the board is built; the pill ({tabId, token}, null for a popup
// Stop) is the HUD instance saying "Saved · in Recents" until the announced
// link reaches it. A later Stop adds a wait and never replaces an earlier
// one, whose pill would otherwise wait for good.
// An 0.9.3 worker stored one object: it reads as a list of one.
const waitsOf = (awaiting) => (Array.isArray(awaiting) ? awaiting : awaiting ? [awaiting] : []);
const waitKey = (wait) => scopeKey(wait.scope || {}, String(wait.sessionId));
const withWaits = serialized();

// The waits' one read-modify-write, so a Stop's add never races a poll's drop.
function editWaits(edit) {
  return withWaits(async () => {
    const next = edit(waitsOf((await chrome.storage.local.get("awaiting")).awaiting));
    if (next.length) {
      await chrome.storage.local.set({ awaiting: next });
    } else {
      await chrome.storage.local.remove("awaiting");
      chrome.alarms.clear("vt-board-ready");
    }
  });
}
const dropWait = (wait) => editWaits((waits) => waits.filter((w) => waitKey(w) !== waitKey(wait)));

async function watchForBoard(sessionId, title, initial, scope, pill) {
  const wait = { sessionId, title, since: Date.now(), scope, pill };
  await editWaits((waits) => [...waits.filter((w) => waitKey(w) !== waitKey(wait)), wait]);
  chrome.alarms.create("vt-board-ready", { periodInMinutes: 0.5 });
  if (initial && initial.projection && initial.projection.state === "ready") {
    return announceBoard(initial, wait);
  }
  pollForBoard();
}

let boardPollTimer = null;
function pollForBoard() {
  if (boardPollTimer) return;
  boardPollTimer = setTimeout(async () => {
    boardPollTimer = null;
    // Side by side: a slow read of one wait never holds another's.
    const { awaiting } = await chrome.storage.local.get("awaiting");
    await Promise.all(waitsOf(awaiting).map(checkBoard));
    if ((await chrome.storage.local.get("awaiting")).awaiting) pollForBoard();
  }, READY_POLL_MS);
}

// One wait's read: announce its board, drop it (given up, failed, empty) or
// keep waiting (still projecting, or a transient failure).
async function checkBoard(wait) {
  if (Date.now() - wait.since > READY_GIVE_UP_MS) return dropWait(wait);
  // Asked only of the server the session lives on, in its own workspace;
  // after a base switch the wait just runs out (the recents refresh, or
  // switching back, still finds the board).
  const scope = wait.scope;
  if (scope && scope.base !== (await getConfig()).base) return;
  let ses;
  try {
    ses = await api("GET", `/api/v1/sessions/${wait.sessionId}`, undefined, undefined,
      { ...(scope ? { base: scope.base, workspace: scope.workspace } : {}), timeoutMs: READY_READ_TIMEOUT_MS });
  } catch {
    return; // transient (a timeout included) — keep waiting
  }
  const p = ses.projection || {};
  if (p.state === "ready" && ses.boardSlug) return announceBoard(ses, wait);
  if (p.state === "failed" || p.state === "empty") {
    await dropWait(wait);
    if (p.state === "failed") notify("Session couldn't be projected", p.error || "see the sessions page");
  }
}

async function announceBoard(ses, wait) {
  await dropWait(wait);
  // The board's address is the server's (`boardUrl`, workspace-prefixed);
  // composing `${base}/boards/<slug>` here lost the /w/<ws> segment and
  // 404'd on "Open board". No server-minted address (a pre-2026-09-21
  // server) means no link — the popup's board row then reads "ready" without
  // an href rather than pointing at a 404.
  const url = ses.boardUrl || (ses.board && ses.board.url) || "";
  // Remembered so the popup can offer "Open board" for the last recording
  // even if the notification was missed.
  await chrome.storage.local.set({ lastBoard: {
    sessionId: ses.id, title: wait.title || ses.title, url, at: Date.now(),
  } });
  if (url && wait.scope) await updateRecent(wait.scope, String(ses.id), { boardUrl: url, status: "saved" });
  // That write repainted only a live recording's tabs. The stopping pill
  // turns "in Recents" into Open board when told — that instance alone, by
  // its token: a Start in its tab since injected a new one, whose Saved face
  // must never take this session's link (#N repeats across workspaces).
  if (url && wait.pill) {
    chrome.tabs.sendMessage(wait.pill.tabId, { type: "vt-board", hud: wait.pill.token, sessionId: String(ses.id), boardUrl: url }).catch(() => {});
  }
  notify("Board ready", `${wait.title || ses.title} — click to open`, url);
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
    await pushEvents([{ tabId: known.id, tabHost: known.host, kind: "nav", payload: { url: redactUrl(rec, d.url), route: routeOf(d.url) } }]);
    try {
      await chrome.scripting.executeScript({ target: { tabId: d.tabId }, files: CONTENT_FILES });
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
      await pushEvents([{ tabId: (await tabInfo(d.tabId)).id, tabHost: host, kind: "nav", payload: { url: redactUrl(rec, d.url), route: routeOf(d.url) } }]);
      await shoot(d.tabId, { route: routeOf(d.url), url: d.url });
    }
  } catch { /* resolve down — tab simply doesn't join */ }
});

// SPA navigations (History API) come from webNavigation, not the page.
chrome.webNavigation.onHistoryStateUpdated.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const tab = await tabInfo(d.tabId);
  if (!tab) return;
  const rec = await getState();
  await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "nav", payload: { url: redactUrl(rec, d.url), route: routeOf(d.url), spa: true } }]);
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
  const recording = await getState();
  const laneId = recording?.tabs[String(tabId)]?.id;
  if (!laneId) return;
  await withLock(async () => {
    const current = await getState();
    if (!sameRecording(current, recording) || current.tabs[String(tabId)]?.id !== laneId) return;
    delete current.tabs[String(tabId)];
    await setState(current);
  });
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

// ---------------------------------------------------------------------------
// the shared HUD's account, prefs and recents
//
// The in-page HUD is @vitrinka/web's (content.js adapts it). What it shows
// beyond the recording lives here, in chrome.storage.local, so every tab
// paints the same answer:
//   hudRecents  the device's recordings, newest first —
//               {base, workspace, sessionId, title, startedAt, durationMs?, status, boardUrl?};
//               one is (base, workspace, sessionId), and the HUD lists the
//               last five of the current base + workspace only
//   hudPrefs    {size, verbose, sheetW, sheetH}; a linked user's server copy wins
//   hudMe       who the token records as (GET /api/v1/recorder/me)
// The same rules as the kit's recorder (packages/web/src/recorder/me.ts,
// recents.ts): a 404 means a server without the route (prefs stay on the
// device), a 409 a key build with no user to store against. The sheet size
// (sheetW/sheetH, CSS px 0..1600, 0 = the HUD's default) rides its own
// PATCH: a server before it answers 422, and the size then stays on the
// device for this worker's lifetime, never costing size/verbose their sync.

const HUD_SIZES = ["sm", "md", "lg"];
const HUD_SHEET_KEYS = ["sheetW", "sheetH"];
const HUD_SHEET_MAX = 1600;
const HUD_DEFAULT_PREFS = { size: "md", verbose: false, sheetW: 0, sheetH: 0 };
const MAX_RECENTS = 5;
// Kept across every base + workspace, so switching back still finds them.
const MAX_STORED_RECENTS = 20;

// A sheet size: a finite number ≥ 0 (within what the server stores), else 0.
const hudSheetPx = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, HUD_SHEET_MAX) : 0);

function hudPrefsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    size: HUD_SIZES.includes(raw.size) ? raw.size : HUD_DEFAULT_PREFS.size,
    verbose: typeof raw.verbose === "boolean" ? raw.verbose : HUD_DEFAULT_PREFS.verbose,
    sheetW: hudSheetPx(raw.sheetW),
    sheetH: hudSheetPx(raw.sheetH),
  };
}

// The account answers for ONE credential: hudMe is stored with the digest of
// the base + token it was read with (hudMeFor), and a link, a new token or a
// new base (options page) makes it nobody's — even across a worker restart.
async function credKey(cfg) {
  const { base, token } = cfg || await getConfig();
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${base}\n${token}`));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Only a vkr_ recorder token (device link or admin key) has a /recorder/me
// identity; a vkp_ personal or vks_ service token is answered locally.
const isRecorderToken = (token) => /^vkr_/.test(token || "");

// A definite identity line the server did not supply: the HUD's menu then
// reads "<name> · <workspace>" (or "Linked device · <workspace>"), never
// "checking who this is…" for good.
function staticAccount(name, workspace) {
  return {
    kind: "linked", workspace: { slug: workspace || "", name: workspace || "" },
    user: name ? { email: "", name } : null, project: null, label: null,
  };
}

// The credentials whose /me read ended without an answer (any failure). Per
// credential, so a late failure for an earlier one never unsettles the
// current one (a single slot is overwritten by whichever failed last).
const meSettled = new Set();

// The account the HUD shows: the cached one when it belongs to the
// configured credential, else a static line. null only while a recorder token's first /me
// read is in flight — bounded by ME_TIMEOUT_MS.
async function currentMe(cfg) {
  const { hudMe = null, hudMeFor = "" } = await chrome.storage.local.get(["hudMe", "hudMeFor"]);
  const key = await credKey(cfg);
  if (hudMe && hudMeFor === key) return hudMe;
  const { token, workspace } = cfg || await getConfig();
  const rec = await getState();
  const ws = (rec && rec.workspace) || workspace;
  if (!isRecorderToken(token)) return staticAccount(token ? "API token" : "No token", ws);
  return meSettled.has(key) ? staticAccount("", ws) : null;
}

// The stored recents that name their base: an entry written before 0.9.1
// carries none, so nothing says which server or workspace its id belongs to.
// Such entries are dropped rather than attributed to the current settings —
// after a switch that would pin another deployment's #N to this one's board.
async function storedRecents() {
  const { hudRecents = [] } = await chrome.storage.local.get("hudRecents");
  return hudRecents.filter((r) => r && typeof r.base === "string" && r.base && typeof r.sessionId === "string");
}

// The base + workspace the HUD answers for: the live recording's, else the
// configured one, else the recorder token's own; a personal token with no
// workspace set records wherever the tab's host resolves, so its newest
// recording on this base names it.
async function hudScope(recents, hudMe) {
  const { base, workspace } = await getConfig();
  const rec = await getState();
  const newest = recents.find((r) => r.base === base);
  return {
    base,
    workspace: (rec && rec.workspace) || workspace || (hudMe && hudMe.workspace && hudMe.workspace.slug) || (newest && newest.workspace) || "",
  };
}

async function hudState() {
  const { hudPrefs = null } = await chrome.storage.local.get("hudPrefs");
  const recents = await storedRecents();
  const hudMe = await currentMe();
  const scope = await hudScope(recents, hudMe);
  const rec = await getState();
  return {
    base: scope.base,
    workspace: scope.workspace,
    live: rec ? String(rec.sessionId) : null,
    recents: recents.filter((r) => r.base === scope.base && r.workspace === scope.workspace).slice(0, MAX_RECENTS),
    prefs: hudPrefsOf(hudPrefs) || HUD_DEFAULT_PREFS,
    account: hudMe,
    // The HUD's paperclip: only while the live recording's policy answer said
    // `attachments: true` (recorder attachments D6; absent = an older server).
    canAttach: !!rec && rec.attachments === true,
  };
}

// Every recorded tab repaints from the new state; a tab whose session just
// ended asks again itself (its menu refreshes on open).
async function broadcastHud() {
  const rec = await getState();
  if (!rec) return;
  const hud = await hudState();
  for (const tabId of Object.keys(rec.tabs || {})) {
    chrome.tabs.sendMessage(Number(tabId), { type: "vt-hud", hud }).catch(() => {});
  }
}

// Start, stop, the board wait and the menu's refresh all rewrite the list;
// one chain keeps a slow writer from restoring what another just changed.
const withRecents = serialized();

async function writeRecents(list) {
  await chrome.storage.local.set({ hudRecents: list.slice(0, MAX_STORED_RECENTS) });
  await broadcastHud();
}

// entry carries its scope: {base, workspace, sessionId, …}.
function noteRecent(entry) {
  return withRecents(async () => {
    const key = scopeKey(entry, entry.sessionId);
    await writeRecents([entry, ...(await storedRecents()).filter((r) => scopeKey(r, r.sessionId) !== key)]);
  });
}

function updateRecent(scope, sessionId, patch) {
  return withRecents(async () => {
    const key = scopeKey(scope, sessionId);
    const recents = await storedRecents();
    if (!recents.some((r) => scopeKey(r, r.sessionId) === key)) return;
    await writeRecents(recents.map((r) => (scopeKey(r, r.sessionId) === key ? { ...r, ...patch } : r)));
  });
}

// Fill the board links the HUD's list lacks through the session's own read,
// on the entry's own base (the configured one — this token is never sent to
// another server) in the entry's own workspace; the live recording is skipped
// (its link arrives with its stop). Each entry is asked once per worker life,
// so a refused read is not retried on every menu.
const recentsAsked = new Set();
async function refreshRecents() {
  const { recents } = await hudState();
  const rec = await getState();
  const live = rec ? scopeKey(await scopeOf(rec.workspace), rec.sessionId) : null;
  for (const r of recents) {
    const key = scopeKey(r, r.sessionId);
    if (r.boardUrl || r.status === "deleted" || key === live || recentsAsked.has(key)) continue;
    if (r.base !== (await getConfig()).base) continue; // the base changed since the list was read
    recentsAsked.add(key);
    try {
      const ses = await api("GET", `/api/v1/sessions/${r.sessionId}`, undefined, undefined, { base: r.base, workspace: r.workspace });
      const boardUrl = ses.boardUrl || (ses.board && ses.board.url) || "";
      if (ses.deletedAt) await updateRecent(r, r.sessionId, { status: "deleted" });
      else if (boardUrl) await updateRecent(r, r.sessionId, { boardUrl, ...(ses.status === "done" ? { status: "saved" } : {}) });
    } catch (e) {
      if (statusOf(e) === 404) await updateRecent(r, r.sessionId, { status: "deleted" });
      else console.warn(`vitrinka: could not refresh recent session ${r.sessionId} (${r.workspace || "default workspace"} on ${r.base})`, e);
    }
  }
}

// A 404 says the server has no /recorder/me — not asked again while that
// credential stays. Other failures settle the state but are retried later.
const meUnavailable = new Set();
const meWarned = new Set();
// The credentials whose server answered the sheet-size PATCH 422 (it predates
// sheetW/sheetH): the size stays on the device, never sent again this worker.
const meSheetLocal = new Set();
const ME_TIMEOUT_MS = 8000;
// Local prefs edits so far: a /me answer adopts its prefs only when no edit
// happened since its request left, so a slow GET never reverts a choice.
let prefEdits = 0;

// Any /me failure (401/403/404/409, network, timeout): the cached or local
// state stands, said once per credential.
function noteMeFailed(e, key) {
  meSettled.add(key);
  if (statusOf(e) === 404) meUnavailable.add(key);
  if (meWarned.has(key)) return;
  meWarned.add(key);
  console.warn("vitrinka: /recorder/me failed — the HUD keeps its cached account and on-device prefs", e);
}

// `key` is the credential the request left with: an answer for an earlier
// one (re-linked meanwhile) is dropped.
async function adoptMe(me, gen, key) {
  const ok = me && (me.kind === "linked" || me.kind === "key") && me.workspace && typeof me.workspace.slug === "string";
  if (!ok) {
    console.warn("vitrinka: /recorder/me answered an unexpected shape — ignored");
    return;
  }
  if (key !== (await credKey())) return;
  const account = { kind: me.kind, workspace: me.workspace, user: me.user || null, project: me.project || null, label: me.label || null };
  const server = hudPrefsOf(me.prefs);
  await chrome.storage.local.set({ hudMe: account, hudMeFor: key });
  // On the prefs chain, so the check and the write see the same edit count;
  // never over an edit this credential's server has not acknowledged yet.
  if (server) await withPrefs(async () => {
    const pending = await pendingPrefs();
    if (gen !== prefEdits || (pending && pending.for === key)) return;
    // An answer without the sheet size (a server before it), or one this
    // credential stopped sending it to, keeps the device's.
    const { hudPrefs = null } = await chrome.storage.local.get("hudPrefs");
    const local = hudPrefsOf(hudPrefs) || HUD_DEFAULT_PREFS;
    for (const f of HUD_SHEET_KEYS) if (meSheetLocal.has(key) || typeof me.prefs[f] !== "number") server[f] = local[f];
    await chrome.storage.local.set({ hudPrefs: server });
  });
}

// Soft failures (offline, an old server) keep the cached account; a 401/403
// is a real refusal, logged, never an error to show.
async function hudGetMe() {
  const key = await credKey();
  const { base, token } = await getConfig();
  if (!base || !isRecorderToken(token) || meUnavailable.has(key)) return;
  // An edit a failed PATCH left unacknowledged goes first: the read then
  // answers with it, rather than reverting it — after a worker restart too.
  if (await pendingPrefs()) await withPrefsSync(sendPrefs);
  const gen = prefEdits;
  try {
    await adoptMe(await api("GET", "/api/v1/recorder/me", undefined, undefined, { timeoutMs: ME_TIMEOUT_MS }), gen, key);
  } catch (e) {
    noteMeFailed(e, key);
  }
  await broadcastHud();
}

// Prefs are a read-modify-write of hudPrefs that two quick edits (size, then
// details) or two recorded tabs race: every write of hudPrefs — an edit, or a
// /me answer adopting the server's copy — runs on withPrefs and merges into
// what is stored at that moment. The server sees the edits on withPrefsSync,
// one PATCH at a time in edit order, each carrying every change it has not
// acknowledged yet.
const withPrefs = serialized();
const withPrefsSync = serialized();

// hudPrefsPending {for, prefs}: the edits the server has not acknowledged,
// sent or not, and the credential (credKey) they were made under. Stored, so
// a worker restart neither loses nor reverts them; bound to that credential,
// so a relink never sends one account's edit to another: the edit is dropped
// and the new account's server copy wins, as on any relink (hudPrefs above).
async function pendingPrefs() {
  const { hudPrefsPending = null } = await chrome.storage.local.get("hudPrefsPending");
  return hudPrefsPending && hudPrefsPending.prefs && Object.keys(hudPrefsPending.prefs).length ? hudPrefsPending : null;
}

// Drops the fields `sent` acknowledged (all of them when null) from the
// pending edits made under `key`; a newer value for a field stays pending.
function settlePrefs(key, sent) {
  return withPrefs(async () => {
    const pending = await pendingPrefs();
    if (!pending || pending.for !== key) return;
    const left = sent ? Object.fromEntries(Object.entries(pending.prefs).filter(([k, v]) => sent[k] !== v)) : {};
    if (Object.keys(left).length) await chrome.storage.local.set({ hudPrefsPending: { for: key, prefs: left } });
    else await chrome.storage.local.remove("hudPrefsPending");
  });
}

async function hudSetPrefs(patch) {
  await withPrefs(async () => {
    const key = await credKey();
    const { hudPrefs = null } = await chrome.storage.local.get("hudPrefs");
    const pending = await pendingPrefs();
    await chrome.storage.local.set({
      hudPrefs: hudPrefsOf({ ...(hudPrefsOf(hudPrefs) || HUD_DEFAULT_PREFS), ...patch }),
      hudPrefsPending: { for: key, prefs: { ...(pending && pending.for === key ? pending.prefs : {}), ...patch } },
    });
    prefEdits++;
  });
  await broadcastHud();
  await withPrefsSync(sendPrefs);
}

async function sendPrefs() {
  // Read together under the prefs chain: the answer to this PATCH is adopted
  // only if no edit outside this delta happened since.
  const { pending, gen } = await withPrefs(async () => ({ pending: await pendingPrefs(), gen: prefEdits }));
  if (!pending) return; // an earlier PATCH already carried this edit
  // ONE settings read decides and sends: the key the edit is checked against,
  // the eligibility, and the base/workspace/token the PATCH carries. Settings
  // relink by writing storage directly (options.js), so any later reread
  // could put this account's edit under the next account's token.
  const cred = await getConfig();
  const key = await credKey(cred);
  if (pending.for !== key) return void (await settlePrefs(pending.for, null)); // another credential's: dropped, never sent
  // Prefs stay on the device for every credential the server cannot store
  // them against: a non-recorder token, a server without the route, a key.
  const hudMe = await currentMe(cred);
  if (!cred.base || !isRecorderToken(cred.token) || meUnavailable.has(key) || (hudMe && hudMe.kind === "key")) return void (await settlePrefs(key, null));
  const workspace = await activeWorkspace(cred.workspace);
  // Relinked while deciding: the edit belongs to the account left behind and
  // is dropped (the new account's server copy wins, as on any relink).
  if ((await credKey()) !== key) return void (await settlePrefs(key, null));
  // size/verbose, then the sheet size in a PATCH of its own: a server before
  // sheetW/sheetH answers that one 422, and the size stays on the device.
  const hud = {};
  const sheet = {};
  for (const [f, v] of Object.entries(pending.prefs)) (HUD_SHEET_KEYS.includes(f) ? sheet : hud)[f] = v;
  if (meSheetLocal.has(key) && Object.keys(sheet).length) {
    await settlePrefs(key, sheet);
    for (const f of HUD_SHEET_KEYS) delete sheet[f];
  }
  try {
    let me = null;
    for (const prefs of [hud, sheet]) {
      if (!Object.keys(prefs).length) continue;
      try {
        me = await api("PATCH", "/api/v1/recorder/me", { prefs }, undefined, { timeoutMs: ME_TIMEOUT_MS, cred, workspace });
        await settlePrefs(key, prefs);
      } catch (e) {
        if (prefs !== sheet || statusOf(e) !== 422) throw e;
        meSheetLocal.add(key);
        await settlePrefs(key, prefs);
        console.warn("vitrinka: this server keeps no sheet size — it stays on this device", e);
      }
    }
    if (me) await adoptMe(me, gen, key);
  } catch (e) {
    // 404 (no route) and 409 (a key build): the server can never store them.
    if (statusOf(e) === 404 || statusOf(e) === 409) await settlePrefs(key, null);
    noteMeFailed(e, key);
  }
  await broadcastHud();
}

// Messages from content scripts + popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tab = sender.tab ? await tabInfo(sender.tab.id) : null;
    switch (msg.type) {
      // NB: every case must end in sendResponse — a throw before it would
      // leave the sender's promise unsettled until Chrome collects the port
      // (the content script's rrweb start waits on exactly that), hence the
      // catch at the bottom of this IIFE.
      case "vt-click":
        if (tab) {
          // Content masks field values; the remaining label can still carry
          // a secret. Apply the same text pass as the Expo press-label lane.
          const rec = await getState();
          const payload = { ...msg.payload, text: vtRedact.redactText(rulesOf(rec), (msg.payload && msg.payload.text) || "") };
          await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "click", payload }]);
          await shoot(sender.tab.id, { route: msg.route, title: sender.tab.title, url: sender.tab.url });
        }
        return sendResponse({ ok: true });
      case "vt-note":
        if (tab) {
          // Fixed before the images decode (pushNote refuses any other).
          const startedIn = await getState();
          // An image can BE the note: one sent with images but no text stands
          // only while an image survives (attachmentsOf, the workspace switch).
          const asked = Array.isArray(msg.attachments) && msg.attachments.length > 0;
          await pushNote(startedIn, sender.tab.id, msg.payload, await attachmentsOf(msg.attachments), !asked || !!(msg.payload && msg.payload.text));
        }
        return sendResponse({ ok: true });
      case "vt-snap":
        if (tab) {
          // `task` rides with the note so the projection can file the
          // annotation it authors as an intake draft too (the destination the
          // tester picked in the HUD before sending). A task destination
          // admits a note-less snap — the server titles it from the region —
          // because choosing "task" and getting nothing would be a silent
          // no-op; so does an attached image. Without either, an empty note
          // stays a screenshot as before. The note and its shot both belong
          // to the recording the snap was asked in, fixed before the decode.
          const startedIn = await getState();
          await pushNote(startedIn, sender.tab.id,
            { text: msg.payload.note, rect: msg.payload.rect, selector: msg.payload.selector, annotate: true, task: !!msg.payload.task },
            await attachmentsOf(msg.attachments), !!(msg.payload.note || msg.payload.task));
          lastShot = 0; // a deliberate snap always captures
          await shoot(sender.tab.id, { route: msg.route, title: sender.tab.title, url: sender.tab.url, snap: true }, startedIn);
        }
        return sendResponse({ ok: true });
      case "vt-console":
        if (tab) await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "console", payload: msg.payload }]);
        return sendResponse({ ok: true });
      case "vt-vitals":
        // Web Vitals per step (sessions-UI D8): one LCP/CLS/INP event per
        // loaded document; the timeline renders it as a ⚡ chip on the step.
        if (tab) {
          const rec = await getState();
          const payload = { ...msg.payload, url: redactUrl(rec, (msg.payload && msg.payload.url) || "") };
          await pushEvents([{ tabId: tab.id, tabHost: tab.host, kind: "vitals", payload }]);
        }
        return sendResponse({ ok: true });
      case "vt-rrweb": {
        const rec = await getState();
        // Accepted while `stopping` on purpose: detachAll's final batch is the
        // tail of the recording and must not be refused.
        if (rec && tab && !rec.paused && !rec.dead) {
          // rrweb's Meta event stamps the page URL beside each full snapshot.
          // It is outside rrweb's text/input masking, so scrub it before IDB.
          const events = msg.events.map((ev) => ev && ev.type === 4 && ev.data && typeof ev.data.href === "string"
            ? { ...ev, data: { ...ev.data, href: redactUrl(rec, ev.data.href) } } : ev);
          const { parts, bodies, dropped } = splitRRWebEvents(events);
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
        // pair rides along so a freshly injected page paints the line
        // immediately instead of waiting out the next poll window — but only
        // ever the CURRENT session's state (session-keyed cache). pairPanel
        // is the websocket panel's whole snapshot, same keying.
        return sendResponse({ rec, elapsedMs: elapsedOf(rec), health: await health(), pair: pairStateFor(rec), pairPanel: pairPanelFor(rec) });
      }
      case "vt-policy": {
        // The content script asks before starting rrweb. The KEY/URL defaults
        // fail closed, but the DOM/pixel directives' default is the
        // PERMISSIVE side (maskAllText TIGHTENS) — answering from an
        // unsettled state would start rrweb unmasked in a masked workspace,
        // permanently (rrweb configures once). Wait bounded for the in-flight
        // fetch+apply chain; if STILL unsettled — which after the chain fix
        // means a genuinely hung/dead policy endpoint — answer STRICT (mask
        // everything, blur). That over-masks THAT session's whole DOM stream
        // (rrweb never reconfigures), which is the safe direction; a healthy
        // backend settles inside the wait and never takes this branch.
        let rec = await getState();
        if (rec && rec.policy === undefined) {
          rec = await awaitPolicySettled(2000);
        }
        if (rec && rec.policy === undefined) {
          return sendResponse({
            ok: true, policy: null,
            mask: { maskAllInputs: true, maskAllText: true, maskTextSelector: "*" },
            pixel: "blur",
          });
        }
        // `mask` is the ENGINE's directive mapping (maskDirectives) so the
        // DOM semantics can never drift from the shared implementation;
        // 'blur' ⇒ keyframes are 96px wide — the content script scales its
        // click/snap rects into that pixel space.
        return sendResponse({
          ok: true,
          policy: (rec && rec.policy) || null,
          mask: vtRedact.maskDirectives(rulesOf(rec)),
          pixel: vtRedact.pixelPolicy(rulesOf(rec)),
        });
      }
      case "vt-health":
        return sendResponse(await health());
      // The shared HUD's account, prefs and recents (hudState above).
      case "vt-hud":
        return sendResponse(await hudState());
      case "vt-hud-me":
        await hudGetMe();
        return sendResponse(await hudState());
      case "vt-hud-prefs": {
        const p = msg.patch || {};
        const patch = {};
        if (HUD_SIZES.includes(p.size)) patch.size = p.size;
        if (typeof p.verbose === "boolean") patch.verbose = p.verbose;
        for (const f of HUD_SHEET_KEYS) if (typeof p[f] === "number" && Number.isFinite(p[f])) patch[f] = hudSheetPx(p[f]);
        if (Object.keys(patch).length) await hudSetPrefs(patch);
        return sendResponse(await hudState());
      }
      case "vt-hud-recents":
        await refreshRecents();
        return sendResponse(await hudState());
      case "vt-open-options":
        // Linking is the options page's device-code dance; a content script
        // cannot open it itself.
        await chrome.runtime.openOptionsPage();
        return sendResponse({ ok: true });
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
        try { return sendResponse({ ok: true, done: await stopSession(sender.tab && msg.hud ? { tabId: sender.tab.id, token: String(msg.hud) } : null) }); }
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
      // Pair panel writes — ALL durable, ALL over REST (the websocket only
      // echoes the results back as frames). Each answers {ok} or {ok:false,
      // error} so the panel can say what happened.
      // Id-taking writes act ONLY on ids the worker itself knows as this
      // session's items: the panel lives in an open shadow root inside an
      // untrusted page, which can rewrite data-id attributes and synthesize
      // clicks — the credential must never be spendable against arbitrary
      // annotations (r3886550907). The worker's item list came from the
      // authenticated WS/poll, never from the page.
      case "vt-pair-panel": {
        const rec2 = await getState();
        connectPairWS().catch(() => {});
        return sendResponse({ ok: true, panel: pairPanelFor(rec2) });
      }
      case "vt-pair-thread": {
        if (!pairItemKnown(await getState(), msg.id)) return sendResponse({ ok: false, error: "not a pair item of this session" });
        try {
          return sendResponse({ ok: true, annotation: await api("GET", `/api/v1/annotations/${msg.id}`) });
        } catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      }
      case "vt-pair-reply": {
        if (!pairItemKnown(await getState(), msg.id)) return sendResponse({ ok: false, error: "not a pair item of this session" });
        try {
          await api("POST", `/api/v1/annotations/${msg.id}/messages`, { author: "user", body: msg.body });
          return sendResponse({ ok: true });
        } catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      }
      case "vt-pair-new": {
        const rec2 = await getState();
        if (!rec2 || !rec2.sessionId) return sendResponse({ ok: false, error: "no live recording" });
        try {
          const made = await api("POST", `/api/v1/sessions/${rec2.sessionId}/pair/items`,
            // The panel mints ONE key per draft and keeps it until the item
            // is confirmed — a retry after a lost response replays the same
            // key and dedupes server-side instead of duplicating (r3886550919).
            { text: msg.text, clientKey: msg.clientKey || pairWriteKey() });
          return sendResponse({ ok: true, id: made.id });
        } catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      }
      case "vt-pair-accept": {
        if (!pairItemKnown(await getState(), msg.id)) return sendResponse({ ok: false, error: "not a pair item of this session" });
        try {
          await api("PATCH", `/api/v1/annotations/${msg.id}`, { status: "resolved" });
          return sendResponse({ ok: true });
        } catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      }
      case "vt-pair-bounce": {
        if (!pairItemKnown(await getState(), msg.id)) return sendResponse({ ok: false, error: "not a pair item of this session" });
        // Bounce = the board's own re-queue gesture, verbatim: a user reply
        // re-stages finished work, the release dispatches it (open + wake).
        // A 409 from release means the item wasn't staged (already back in
        // the queue) — the reply still landed, so that is success.
        try {
          await api("POST", `/api/v1/annotations/${msg.id}/messages`,
            { author: "user", body: msg.body || "bounced from the pair panel — still broken" });
          try {
            await api("POST", `/api/v1/annotations/${msg.id}/release`);
          } catch (e) {
            if (statusOf(e) !== 409) throw e;
          }
          return sendResponse({ ok: true });
        } catch (e) { return sendResponse({ ok: false, error: String(e.message || e) }); }
      }
    }
    sendResponse({ ok: false, error: "unknown message" });
  })().catch((e) => {
    // A throw before sendResponse would otherwise leave the sender's promise
    // unsettled for a nondeterministic interval (until Chrome collects the
    // dropped port) — settle it with an error instead.
    console.warn("vitrinka: message handler failed", msg && msg.type, e);
    try { sendResponse({ ok: false, error: String(e) }); } catch { /* port gone */ }
  });
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
globalThis.__vtTest = { vtdb, drainQueue, reconcile, reapDeadSessions, shoot, splitRRWebEvents, enqueue, hudState, hudSetPrefs, hudGetMe, sendPrefs, withLock, noteRecent, updateRecent, refreshRecents, watchForBoard };

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
