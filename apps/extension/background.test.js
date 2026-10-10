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
  let messageListener;
  const db = {
    put: async (item) => writes.push({ ...item, needsBlob: item.blob ? 1 : 0 }),
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
      tabs: { get: async () => ({ active: true, windowId: 1 }), sendMessage: async () => ({}), captureVisibleTab: async () => { captures.push(true); return "data:image/png;base64,AA=="; }, onActivated: event(), onRemoved: event() },
      scripting: { executeScript: async () => [] },
      debugger: { onEvent: event(), onDetach: event() },
      alarms: { onAlarm: event(), create() {} },
      webNavigation: { onCommitted: event(), onHistoryStateUpdated: event() },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: { onMessage: { addListener(listener) { messageListener = listener; } }, onStartup: event(), getManifest: () => ({ version: "0.10.0" }) },
      commands: { onCommand: event() },
    },
  });
  runInContext(source, context);
  return { data, writes, captures, requests, context, db,
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
