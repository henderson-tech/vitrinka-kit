import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import * as vtRedact from "./vendor/redact.js";

// Evaluate the shipped worker; inject dependencies and skip only its boot side effect.
const source = readFileSync(new URL("./background.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "").replace(/^boot\(\);$/m, "");
const deferred = () => { let resolve; const promise = new Promise((res) => { resolve = res; }); return { promise, resolve }; };
const clone = (value) => structuredClone(value);
function worker({ response = { policy: null }, status = 200 } = {}) {
  const data = { base: "https://synthetic.test", workspace: "qa", captureNetwork: false,
    rec: { sessionId: 1, generation: "first", tabs: {}, seq: 0 } };
  const writes = [], captures = [], requests = [];
  // Open tabs, every chrome.scripting call, every message to a tab; `script`
  // answers an injection (its per-frame results).
  const tabs = [], injections = [], tabMessages = [], registered = new Set();
  let script = () => [];
  let messageListener, commandListener, navListener;
  const db = {
    put: async (item) => { // upserts by [sessionId, seq], like the IndexedDB keyPath
      const at = writes.findIndex((i) => i.sessionId === item.sessionId && i.seq === item.seq);
      writes.splice(at < 0 ? writes.length : at, at < 0 ? 0 : 1, { ...item, needsBlob: item.blob ? 1 : 0 });
    },
    putAll: async (items) => { for (const item of items) writes.push({ ...item, needsBlob: item.blob ? 1 : 0 }); },
    stats: async () => ({ count: writes.length }), sessionStats: async () => ({ count: writes.length, maxSeq: 0 }),
    head: async (sessionId, limit) => writes.filter((i) => i.sessionId === sessionId).sort((a, b) => a.seq - b.seq).slice(0, limit).map((i) => ({ ...i })),
    resolveBlob: async (sessionId, seq, blobKey) => {
      const item = writes.find((i) => i.sessionId === sessionId && i.seq === seq);
      item.blobKey = blobKey; item.needsBlob = 0; delete item.blob;
    },
    remove: async (sessionId, seqs) => {
      for (let i = writes.length - 1; i >= 0; i--) if (writes[i].sessionId === sessionId && seqs.includes(writes[i].seq)) writes.splice(i, 1);
    },
    dropSession: async (sessionId) => {
      for (let i = writes.length - 1; i >= 0; i--) if (writes[i].sessionId === sessionId) writes.splice(i, 1);
    },
  };
  let beforeSet = null;
  const event = () => ({ addListener() {} });
  const context = createContext({
    console, URL, Blob, Date, crypto, AbortSignal, TextEncoder, TextDecoder,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    navigator: { userAgent: "Synthetic worker" }, vtRedact,
    vtdb: db,
    newerVersion: () => false, WORKSPACE_HEADER: "X-Vitrinka-Workspace", vtHeaders: () => ({}),
    fetch: async (url, init) => {
      if (String(url).startsWith("data:")) return fetch(url);
      requests.push({ url: String(url), ...init });
      return { ok: status < 400, status, text: async () => JSON.stringify(String(url).includes("/recorder/policy") ? response : String(url).includes("/shot?") ? { blobKey: "synthetic-image" } : { id: 1, status: "recording", maxSeq: 0 }) };
    },
    createImageBitmap: async () => { throw new Error("synthetic bitmap failure"); },
    chrome: {
      storage: { local: {
        get: async (keys) => keys === "rec" ? { rec: clone(data.rec) } : clone(data),
        set: async (values) => { if (beforeSet) await beforeSet(values); Object.assign(data, clone(values)); },
        remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
      } },
      tabs: { get: async () => ({ active: true, windowId: 1 }), captureVisibleTab: async () => { captures.push(true); return "data:image/png;base64,AA=="; }, onActivated: event(), onRemoved: event(),
        query: async (q) => tabs.filter((t) => !q.active || t.active),
        sendMessage: async (tabId, msg) => { tabMessages.push({ tabId, msg }); return {}; } },
      scripting: {
        executeScript: async (inj) => { injections.push(inj); return script(inj); },
        getRegisteredContentScripts: async ({ ids }) => ids.filter((id) => registered.has(id)).map((id) => ({ id })),
        registerContentScripts: async (list) => { for (const s of list) registered.add(s.id); },
        unregisterContentScripts: async ({ ids }) => { for (const id of ids) registered.delete(id); },
      },
      debugger: { onEvent: event(), onDetach: event() },
      alarms: { onAlarm: event(), create() {} },
      webNavigation: { onCommitted: { addListener(listener) { navListener = listener; } }, onHistoryStateUpdated: event() },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: { onMessage: { addListener(listener) { messageListener = listener; } }, onStartup: event(), onInstalled: event(), getManifest: () => ({ version: "0.10.0" }) },
      commands: { onCommand: { addListener(listener) { commandListener = listener; } } },
    },
  });
  runInContext(source, context);
  return { data, writes, captures, requests, context, db, tabs, injections, tabMessages, registered,
    answer(fn) { script = fn; },
    command(name) { commandListener(name); return new Promise((r) => setTimeout(r, 0)); },
    navigate(d) { return navListener(d); },
    message(msg) { return new Promise((resolve) => messageListener(msg, { tab: { id: 7, title: "Synthetic", url: "https://app.test/" } }, resolve)); },
    interceptSet(fn) { beforeSet = fn; },
    call(expression) { return runInContext(expression, context); } };
}

test("malformed policy documents remain UNKNOWN; transient failures retry, permanent absence settles defaults", async () => {
  for (const policy of ["invalid", [], { maskAllText: "true" }, { fullFidelity: "true" }, { extraBodyKeys: "password" }, { patterns: [1] }]) {
    const w = worker({ response: { policy } });
    expect(await w.call('fetchPolicy("qa")')).toBeUndefined();
  }
  for (const status of [408, 429, 503]) expect(await worker({ status }).call('fetchPolicy("qa")')).toBeUndefined();
  expect(await worker({ status: 404 }).call('fetchPolicy("qa")')).toBeNull();
  expect(await worker({ response: { policy: null } }).call('fetchPolicy("qa")')).toBeNull();
  const wake = worker({ response: { policy: { maskAllText: true } } });
  await wake.call('reconcile()'); await wake.call('pendingPolicy');
  expect(wake.data.rec.policy).toEqual({ maskAllText: true });
});

test("tab attachment cannot overwrite an asynchronously settled workspace policy", async () => {
  const w = worker(); const read = deferred(), release = deferred();
  w.interceptSet(async ({ rec }) => {
    if (rec?.tabs?.["7"] && rec.policy === undefined) { read.resolve(); await release.promise; }
  });
  const attach = w.call('attachTab(7, "https://app.test/")');
  await read.promise;
  w.call('applyPolicyWhenFetched(Promise.resolve({extraBodyKeys:["privateNote"]}), {sessionId:1,generation:"first"}, 7)');
  // Let the competing apply reach storage while attachment holds its write.
  for (let i = 0; i < 12; i++) await Promise.resolve();
  release.resolve(); await attach; await w.call('pendingPolicy');
  expect(w.data.rec.policy).toEqual({ extraBodyKeys: ["privateNote"] });
  expect(w.data.rec.tabs["7"].host).toBe("app.test");
});

test("a stale same-id policy and screenshot cannot enter the next generation; failed blur drops pixels", async () => {
  const w = worker(); const policy = deferred(); w.context.policyPromise = policy.promise;
  w.call('applyPolicyWhenFetched(policyPromise, {sessionId:1,generation:"first"}, 7)');
  w.data.rec = { sessionId: 1, generation: "next", tabs: { "7": { id: "tab1", host: "app.test" } }, seq: 0, policy: { maskAllText: true } };
  policy.resolve({ fullFidelity: true }); await w.call('pendingPolicy');
  expect(w.data.rec.policy).toEqual({ maskAllText: true });
  await w.call('shoot(7, {snap:true})');
  expect(w.captures).toHaveLength(1); expect(w.writes).toHaveLength(0); expect(w.data.rec.seq).toBe(0);
  const next = worker(); const frame = deferred(); next.context.framePromise = frame.promise;
  next.data.rec.policy = null; next.data.rec.tabs["7"] = { id: "tab1", host: "app.test" };
  next.call('chrome.tabs.captureVisibleTab = () => framePromise');
  const shot = next.call('shoot(7, {snap:true})');
  for (let i = 0; i < 12; i++) await Promise.resolve();
  next.data.rec.generation = "next"; next.data.rec.policy = { maskAllText: true };
  frame.resolve("data:image/png;base64,AA=="); await shot;
  expect(next.writes).toHaveLength(0); expect(next.data.rec.seq).toBe(0);
});

test("HUD sheet prefs normalize, persist in chrome storage and PATCH separately", async () => {
  const w = worker();
  expect(w.call('hudPrefsOf({sheetW: -1, sheetH: Infinity})')).toMatchObject({ sheetW: 0, sheetH: 0 });
  expect(w.call('hudPrefsOf({sheetW: "440", sheetH: null})')).toMatchObject({ sheetW: 0, sheetH: 0 });
  w.data.token = "vkr_test";
  w.context.fetch = async (url, init) => {
    w.requests.push({ url: String(url), ...init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ kind: "linked", workspace: { slug: "qa", name: "QA" }, prefs: w.data.hudPrefs }) };
  };
  await w.call('hudSetPrefs({size: "lg", sheetW: 540, sheetH: 470})');
  expect(w.data.hudPrefs).toMatchObject({ size: "lg", sheetW: 540, sheetH: 470 });
  expect(w.requests.filter((r) => r.method === "PATCH").map((r) => JSON.parse(r.body))).toEqual([
    { prefs: { size: "lg" } }, { prefs: { sheetW: 540, sheetH: 470 } },
  ]);
});

test("an older worker server keeps sheet size local without retrying and still syncs size", async () => {
  const w = worker();
  w.data.token = "vkr_test";
  w.context.fetch = async (url, init) => {
    w.requests.push({ url: String(url), ...init });
    const sheet = JSON.parse(init.body).prefs.sheetW !== undefined;
    return { ok: !sheet, status: sheet ? 422 : 200, text: async () => JSON.stringify(sheet
      ? { error: "unknown prefs.sheetW" }
      : { kind: "linked", workspace: { slug: "qa", name: "QA" }, prefs: { size: "lg", verbose: true } }) };
  };
  await w.call('hudSetPrefs({sheetW: 540, sheetH: 470})');
  await w.call('hudSetPrefs({sheetW: 560, sheetH: 490})');
  await w.call('hudSetPrefs({size: "lg", verbose: true})');
  expect(w.requests.filter((r) => r.method === "PATCH").map((r) => JSON.parse(r.body))).toEqual([
    { prefs: { sheetW: 540, sheetH: 470 } }, { prefs: { size: "lg", verbose: true } },
  ]);
  expect(w.data.hudPrefs).toEqual({ size: "lg", verbose: true, sheetW: 560, sheetH: 490 });
});

const image = { name: "reference.webp", dataUrl: "data:image/webp;base64,AQID", w: 20, h: 10 };
const attachedWorker = (options) => {
  const w = worker(options);
  Object.assign(w.data.rec, { policy: null, attachments: true, tabs: { "7": { id: "tab1", host: "app.test" } } });
  return w;
};

test("canAttach follows the policy attachments flag: true, false and absent", async () => {
  for (const flag of [true, false, undefined]) {
    const w = worker({ response: { policy: null, ...(flag === undefined ? {} : { attachments: flag }) } });
    await w.call('const caps = {}; applyPolicyWhenFetched(fetchPolicy("qa", caps), {sessionId:1,generation:"first"}, null, caps); pendingPolicy');
    expect(w.data.rec.attachments).toBe(flag === true);
    expect((await w.call("hudState()")).canAttach).toBe(flag === true);
  }
});

test("a note queues two attachment blobs before the note that lists their seqs", async () => {
  const w = attachedWorker();
  expect(await w.message({ type: "vt-note", payload: { text: "Expected" }, attachments: [image, { ...image, name: "second.webp" }] })).toEqual({ ok: true });
  expect(w.writes.map(({ seq, kind }) => ({ seq, kind }))).toEqual([{ seq: 1, kind: "attachment" }, { seq: 2, kind: "attachment" }, { seq: 3, kind: "note" }]);
  for (const item of w.writes.slice(0, 2)) {
    expect(item.blob).toBeInstanceOf(Blob);
    expect(item.payload).toEqual({ name: item.seq === 1 ? "reference.webp" : "second.webp", mime: "image/webp", bytes: 3, w: 20, h: 10 });
    expect([item.tabId, item.tabHost]).toEqual(["tab1", "app.test"]);
  }
  expect(w.writes[2].payload).toEqual({ text: "Expected", attachments: [1, 2] });
});

test("attachment upload uses shot with its own content type, never chunk", async () => {
  const w = attachedWorker();
  await w.message({ type: "vt-note", payload: { text: "Expected" }, attachments: [image] });
  await w.call("flushInner()");
  const upload = w.requests.find((r) => r.body instanceof Blob);
  expect(upload.url).toBe("https://synthetic.test/api/v1/sessions/1/shot?seq=1");
  expect(upload.headers["content-type"]).toBe("image/webp");
  expect(w.requests.some((r) => r.url.includes("/chunk"))).toBe(false);
});

test("attachment event receives its uploaded blobKey before events are posted", async () => {
  const w = attachedWorker();
  await w.message({ type: "vt-note", payload: { text: "" }, attachments: [image] });
  await w.call("flushInner()");
  const events = JSON.parse(w.requests.find((r) => r.url.endsWith("/events")).body).events;
  expect(events[0]).toMatchObject({ kind: "attachment", seq: 1, blobKey: "synthetic-image" });
  expect(events[1]).toMatchObject({ kind: "note", seq: 2, payload: { text: "", attachments: [1] } });
  expect(w.writes).toHaveLength(0);
});

test("vt-snap carries attachments on its annotation note", async () => {
  const w = attachedWorker();
  w.call("shoot = async () => {}");
  await w.message({ type: "vt-snap", payload: { note: "Expected", rect: { x: 1, y: 2, w: 3, h: 4 }, selector: "button", task: true }, attachments: [image] });
  expect(w.writes[1]).toMatchObject({ kind: "note", payload: { text: "Expected", annotate: true, task: true, attachments: [1] } });
});

test("a note or snap whose images decode across a stop → continue never enters the next generation", async () => {
  for (const type of ["vt-note", "vt-snap"]) {
    const w = attachedWorker(); const decoding = deferred(), decoded = deferred();
    Object.assign(w.context, { decoding: decoding.resolve, decoded: decoded.promise });
    w.call('fetch = () => { decoding(); return decoded; }');
    const sent = w.message({ type, payload: { text: "Expected", note: "Expected", rect: { x: 1, y: 2, w: 3, h: 4 }, selector: "" }, attachments: [image] });
    await decoding.promise;
    w.data.rec.generation = "next";
    decoded.resolve({ blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" }) });
    expect(await sent).toEqual({ ok: true });
    expect(w.writes).toHaveLength(0); expect(w.captures).toHaveLength(0); expect(w.data.rec.seq).toBe(0);
  }
});

test("403 on an attachment upload marks the session dead and preserves its queue like a shot", async () => {
  for (const kind of ["attachment", "shot"]) {
    const w = attachedWorker({ status: 403 });
    await w.db.put({ sessionId: 1, seq: 1, kind, payload: {}, blob: new Blob(["pixels"], { type: "image/png" }), blobCT: "image/png" });
    expect(await w.call("flushInner()")).toBe(false);
    expect(w.data.rec.dead).toBe(true);
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0].needsBlob).toBe(1);
    expect(w.requests.some((r) => r.url.endsWith("/events"))).toBe(false);
    expect(await w.call("flushInner()")).toBe(false);
    expect(w.requests).toHaveLength(1);
  }
});

const queued = (w, seqs, resBody) => Promise.all(seqs.map((seq) => w.db.put({ sessionId: 1, seq, ts: "2026-10-11T17:00:00Z", tabId: "tab1", tabHost: "app.test", kind: "request", payload: { resBody } })));
const eventsServer = (w, capBytes) => {
  const posted = [];
  w.context.fetch = async (url, init) => {
    w.requests.push({ url: String(url), ...init });
    if (new TextEncoder().encode(init.body).length > capBytes) return { ok: false, status: 413, text: async () => '{"error":"too large"}' };
    posted.push(JSON.parse(init.body).events);
    return { ok: true, status: 200, text: async () => '{"inserted":1}' };
  };
  return posted;
};

test("events upload in seq order under the byte target; a 413 halves the batch and never ends the session", async () => {
  const w = worker();
  await queued(w, [1, 2, 3, 4, 5, 6], "x".repeat(4000));
  const posted = eventsServer(w, 10_000);
  for (let i = 0; i < 12 && w.writes.length; i++) await w.call("flushInner()");
  expect(w.data.rec.dead).toBeUndefined();
  expect(w.writes).toHaveLength(0);
  expect(posted.flat().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(posted.every((batch) => batch.length <= 2)).toBe(true);
});

test("an event the server refuses even alone travels as a note at its own seq", async () => {
  const w = worker();
  await queued(w, [1], "x".repeat(4000));
  eventsServer(w, 1000);
  expect(await w.call("flushInner()")).toBe(false);
  const posted = eventsServer(w, 10_000);
  expect(await w.call("flushInner()")).toBe(true);
  expect(posted[0]).toMatchObject([{ seq: 1, kind: "note", payload: { text: expect.stringContaining("request event omitted") } }]);
  expect(w.data.rec.dead).toBeUndefined();
});

test("a session a 413 killed before byte packing uploads its tail and finishes while the server holds it open", async () => {
  for (const [reason, stopping, revived] of [["server rejected this session (413)", false, true], ["server rejected this session (413)", true, true], ["server rejected this session (409)", false, false]]) {
    const w = worker(); const posted = [];
    Object.assign(w.data.rec, { policy: null, dead: true, deadReason: reason, stopping, paused: false, activeMs: 0, resumeAt: "2026-10-11T17:00:00Z" });
    await queued(w, [1, 2], "x");
    w.context.fetch = async (url, init) => {
      w.requests.push({ url: String(url), ...init });
      if (String(url).endsWith("/events")) posted.push(...JSON.parse(init.body).events.map((e) => e.seq));
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: 1, status: "recording", maxSeq: 0, updatedAt: "2026-10-11T17:03:56Z" }) };
    };
    const frozen = []; w.interceptSet(async ({ rec }) => { if (rec && !rec.dead) frozen.push(rec.activeMs); });
    await w.call("reconcile()");
    const patches = () => w.requests.filter((r) => r.method === "PATCH").map((r) => JSON.parse(r.body));
    for (let i = 0; i < 50 && revived && w.data.rec; i++) await new Promise((r) => setImmediate(r));
    if (!revived) { expect(w.data.rec.dead).toBe(true); expect(patches()).toEqual([]); continue; }
    expect(posted).toEqual([1, 2]);
    expect(patches()).toEqual([{ status: "done" }]);
    expect(w.data.rec).toBeNull();
    if (!stopping) expect(frozen[0]).toBe(236_000);
  }
});

test("a revived finish whose close fails is retried by the next reconcile; Start and Continue wait for it", async () => {
  const w = worker(); let closeFails = true;
  Object.assign(w.data.rec, { policy: null, dead: true, deadReason: "server rejected this session (413)", paused: false, activeMs: 0, resumeAt: "2026-10-11T17:00:00Z" });
  w.context.fetch = async (url, init) => {
    w.requests.push({ url: String(url), ...init });
    if (init.method === "PATCH" && closeFails) return { ok: false, status: 503, text: async () => '{"error":"unavailable"}' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 1, status: "recording", maxSeq: 0 }) };
  };
  const closes = () => w.requests.filter((r) => r.method === "PATCH").length;
  const settle = async (done) => { for (let i = 0; i < 50 && !done(); i++) await new Promise((r) => setImmediate(r)); };
  await w.call("reconcile()");
  await settle(() => closes() === 1 && !w.call("finishingRevived"));
  expect(w.data.rec).toMatchObject({ revived: true, stopping: true });
  for (const call of ['startSession("x")', "continueSession(1)"]) await expect(w.call(call)).rejects.toThrow("still uploading");
  closeFails = false;
  await w.call("reconcile()");
  await settle(() => !w.data.rec);
  expect(closes()).toBe(2);
  expect(w.data.rec).toBeNull();
});

test("a stop bound to a recording never stops the one Start or Continue adopted meanwhile", async () => {
  const w = worker();
  w.data.rec = { sessionId: 2, generation: "second", tabs: {}, seq: 0 };
  expect(await w.call('stopSession(null, {sessionId: 1, generation: "first"})')).toBeNull();
  expect(w.data.rec).toMatchObject({ sessionId: 2, generation: "second" });
  expect(w.data.rec.stopping).toBeUndefined();
  expect(w.requests).toHaveLength(0);
});

// ONE recorder (extension + page recorder decisions 2026-10-12).
const pageClaim = (state = "recording") => ({ v: 1, by: "page", id: "p.synthetic", state, sessionId: "42", since: 1 });

test("a Start a page recorder would contest is refused before any network call, named where it records, and leaves no endpoint behind", async () => {
  for (const [where, state, words] of [
    [7, "recording", "this page's own recorder is already recording (#42) — use its pill, or stop it first"],
    [7, "stopping", "this page's recorder is still saving #42 — try again in a moment"],
    [8, "recording", "a page recorder is already recording in another tab (forge.example, #42) — stop it there first"],
  ]) {
    const w = worker();
    w.data.rec = null;
    w.tabs.push({ id: 7, active: true, url: "https://app.test/" }, { id: 8, url: "https://forge.example/studio" }, { id: 9, url: "chrome://extensions" });
    w.answer((inj) => (inj.func && inj.func.name === "oneProbe"
      ? [{ result: { host: inj.target.tabId === 7 ? "app.test" : "forge.example", holder: inj.target.tabId === where ? pageClaim(state) : null } }]
      : []));
    expect(await w.message({ type: "vt-start", title: "x" })).toEqual({ ok: false, error: words, code: "recorder_busy", leader: "page" });
    expect(w.requests).toHaveLength(0);
    // The probe installed the endpoint in every http(s) tab and claimed only the active one.
    expect(w.injections.filter((i) => i.func && i.func.name === "oneProbe").map((i) => [i.target.tabId, i.args[1]])).toEqual([[7, true], [8, false]]);
    // Refused: no registration, no stored state, every endpoint told to go with the claim it took.
    expect(w.registered.size).toBe(0);
    expect(w.data.oneState).toBeUndefined();
    expect(w.tabMessages.filter((m) => m.msg.type === "vt-one").at(-1).msg).toMatchObject({ state: null, release: true });
  }
});

test("Chrome commands relay to the active tab's recorder whether or not the extension records", async () => {
  const w = worker();
  w.data.rec = null;
  w.tabs.push({ id: 7, active: true, url: "https://forge.example/" });
  const relayed = () => w.injections.filter((i) => i.func && i.func.name === "relayChord").map((i) => [i.target.tabId, i.args[0]]);
  // Idle: the page recorder leads, so the chord — ⌥⇧P included — goes to it.
  for (const name of ["snap", "note", "toggle-pause"]) await w.command(name);
  expect(relayed()).toEqual([[7, "KeyA"], [7, "KeyN"], [7, "KeyP"]]);
  // Recording, the tab captured: snap/note reach its content script; ⌥⇧P pauses the extension's own recording.
  w.data.rec = { sessionId: 1, generation: "first", tabs: { "7": { id: "tab1", host: "forge.example" } }, seq: 0, paused: false, resumeAt: "2026-10-12T10:00:00Z" };
  await w.command("note");
  expect(w.tabMessages.at(-1)).toEqual({ tabId: 7, msg: { type: "vt-note-ui" } });
  await w.command("toggle-pause");
  expect(w.data.rec.paused).toBe(true);
  expect(relayed()).toHaveLength(3);
});

test("a tab whose content script met a page recorder's claim leaves the recording", async () => {
  const w = worker();
  w.data.captureNetwork = true;
  const attaches = [];
  w.context.chrome.debugger.attach = async (target) => { attaches.push(target); };
  w.answer((inj) => (inj.files ? [{ result: "yield" }] : []));
  expect(await w.call('attachTab(7, "https://forge.example/")')).toBe(false);
  expect(w.data.rec.tabs).toEqual({});
  expect(attaches).toEqual([]);
  // The claim rode in ahead of content.js, under the recording's generation.
  expect(w.injections[0].args[0]).toEqual({ generation: "first", sessionId: "1", state: "recording" });
});

test("a second Start while one is still probing is refused, and leaves the first's endpoints alone", async () => {
  const w = worker();
  w.data.rec = null;
  w.tabs.push({ id: 7, active: true, url: "https://app.test/" });
  const probing = deferred();
  w.answer((inj) => (inj.func && inj.func.name === "oneProbe" ? probing.promise : []));
  const first = w.message({ type: "vt-start", title: "first" });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(await w.message({ type: "vt-start", title: "second" })).toEqual({ ok: false, error: "a recording is already starting — try again in a moment" });
  expect(w.tabMessages.filter((m) => m.msg.type === "vt-one").map((m) => m.msg.state)).toEqual(["starting"]);
  probing.resolve([{ result: { host: "app.test", holder: pageClaim() } }]);
  expect(await first).toMatchObject({ ok: false, code: "recorder_busy" });
});

test("after an extension reload, a tab whose page recorder started in the gap leaves the recording", async () => {
  const w = worker();
  w.data.rec = { sessionId: 1, generation: "first", tabs: { "7": { id: "tab1", host: "forge.example" }, "8": { id: "tab2", host: "forge.example" } }, seq: 0 };
  w.tabs.push({ id: 7, url: "https://forge.example/a" }, { id: 8, url: "https://forge.example/b" });
  w.answer((inj) => (inj.files && inj.files.includes("content.js") ? [{ result: inj.target.tabId === 8 ? "yield" : undefined }] : []));
  await w.call("reattach()");
  expect(Object.keys(w.data.rec.tabs)).toEqual(["7"]);
  expect(w.registered.has("vitrinka-one")).toBe(true);
});

test("a captured tab that navigates while paused gets its content script back, and records no nav or shot", async () => {
  const w = worker();
  w.data.rec = { sessionId: 1, generation: "first", tabs: { "7": { id: "tab1", host: "forge.example" } }, seq: 0, paused: true };
  await w.navigate({ frameId: 0, tabId: 7, url: "https://forge.example/next" });
  expect(w.injections.find((i) => i.func)?.args[0]).toEqual({ generation: "first", sessionId: "1", state: "paused" });
  expect(w.injections.some((i) => i.files && i.files.includes("content.js"))).toBe(true);
  expect(w.data.rec.seq).toBe(0);
  expect(w.captures).toHaveLength(0);
});

test("a note taken for a recording a new Start replaced is dropped, never filed into the next", async () => {
  const w = worker();
  w.data.rec = { sessionId: 2, generation: "second", tabs: { "7": { id: "tab1", host: "app.test" } }, seq: 0, policy: null };
  expect(await w.message({ type: "vt-note", generation: "first", payload: { text: "for the first", route: "/" } }))
    .toEqual({ ok: false, error: "the recording ended before the note arrived" });
  expect(w.writes).toHaveLength(0);
  expect(await w.message({ type: "vt-note", generation: "second", payload: { text: "for the second", route: "/" } })).toEqual({ ok: true });
  expect(w.writes.map((i) => i.payload.text)).toEqual(["for the second"]);
});

test("an extension reload gives the lanes that stay their debugger back, the flag true to what attached", async () => {
  const w = worker();
  w.data.captureNetwork = true;
  w.data.rec = { sessionId: 1, generation: "first", tabs: { "7": { id: "tab1", host: "a.test", cdp: true }, "8": { id: "tab2", host: "a.test", cdp: true } }, seq: 0 };
  const attached = [];
  w.context.chrome.debugger.detach = async () => {};
  w.context.chrome.debugger.attach = async ({ tabId }) => { if (tabId === 8) throw new Error("Another debugger is already attached"); attached.push(tabId); };
  w.context.chrome.debugger.sendCommand = async () => ({});
  await w.call("reattach({ reloaded: true })");
  expect(attached).toEqual([7]);
  expect(w.data.rec.tabs).toMatchObject({ "7": { cdp: true }, "8": { cdp: false } });
});

test("content.js is injected into the very document its claim bootstrap landed in", async () => {
  const w = worker();
  w.answer((inj) => (inj.func ? [{ documentId: "doc-1" }] : []));
  await w.call('attachTab(7, "https://forge.example/")');
  expect(w.injections.find((i) => i.files && i.files.includes("content.js")).target).toEqual({ tabId: 7, documentIds: ["doc-1"] });
});

test("a replaced recording's tabs are told to retire, and its pills can no longer stop or pause the new one", async () => {
  const w = worker();
  w.data.rec = { sessionId: 1, generation: "old", tabs: { "8": { id: "tab1", host: "app.test" } }, seq: 0 };
  w.tabs.push({ id: 7, active: true, url: "https://app.test/" });
  w.answer((inj) => (inj.func && inj.func.name === "oneProbe" ? [{ result: { host: "app.test", holder: null } }] : []));
  w.context.fetch = async (url, init) => {
    w.requests.push({ url: String(url), ...init });
    const body = String(url).includes("/recorder/resolve") ? { workspace: "qa" } : { id: 2, workspace: "qa", project: "p", status: "recording", maxSeq: 0 };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  expect(await w.message({ type: "vt-start", title: "next" })).toMatchObject({ ok: true });
  expect(w.tabMessages.filter((m) => m.msg.type === "vt-retire")).toEqual([{ tabId: 8, msg: { type: "vt-retire", generation: "old" } }]);
  const stale = { ok: false, error: "this pill's recording was replaced by a newer one — use its pill" };
  expect(await w.message({ type: "vt-stop", generation: "old" })).toEqual(stale);
  expect(await w.message({ type: "vt-pause", generation: "old" })).toEqual(stale);
  expect(w.data.rec).toMatchObject({ sessionId: 2, paused: false });
  expect(w.data.rec.stopping).toBeUndefined();
});

test("a yield that lands after a new recording took the tab never drops the new recording's lane", async () => {
  const w = worker();
  const injected = deferred();
  w.answer((inj) => (inj.files ? injected.promise : []));
  const attach = w.call('attachTab(7, "https://forge.example/")');
  for (let i = 0; i < 30; i++) await Promise.resolve();
  // A new Start adopted meanwhile and attached the same tab, with the same lane id.
  w.data.rec = { sessionId: 2, generation: "second", tabs: { "7": { id: "tab1", host: "forge.example" } }, seq: 0 };
  injected.resolve([{ result: "yield" }]);
  expect(await attach).toBe(false);
  expect(w.data.rec.tabs).toEqual({ "7": { id: "tab1", host: "forge.example" } });
});
