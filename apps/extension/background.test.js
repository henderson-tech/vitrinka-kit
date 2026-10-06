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
  const writes = [], captures = [];
  let beforeSet = null;
  const event = () => ({ addListener() {} });
  const context = createContext({
    console, URL, Blob, Date, crypto, AbortSignal, TextEncoder, TextDecoder,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    navigator: { userAgent: "Synthetic worker" }, vtRedact,
    vtdb: { put: async (item) => writes.push(item), stats: async () => ({ count: 0 }), sessionStats: async () => ({ count: 0, maxSeq: 0 }) },
    newerVersion: () => false, WORKSPACE_HEADER: "X-Vitrinka-Workspace", vtHeaders: () => ({}),
    fetch: async (url) => String(url).startsWith("data:") ? { blob: async () => new Blob(["raw pixels"], { type: "image/png" }) } : { ok: status < 400, status, text: async () => JSON.stringify(String(url).includes("/recorder/policy") ? response : { id: 1, status: "recording", maxSeq: 0 }) },
    createImageBitmap: async () => { throw new Error("synthetic bitmap failure"); },
    chrome: {
      storage: { local: {
        get: async (keys) => keys === "rec" ? { rec: clone(data.rec) } : clone(data),
        set: async (values) => { if (beforeSet) await beforeSet(values); Object.assign(data, clone(values)); },
      } },
      tabs: { get: async () => ({ active: true, windowId: 1 }), sendMessage: async () => ({}), captureVisibleTab: async () => { captures.push(true); return "data:image/png;base64,AA=="; }, onActivated: event(), onRemoved: event() },
      scripting: { executeScript: async () => [] },
      debugger: { onEvent: event(), onDetach: event() },
      alarms: { onAlarm: event(), create() {} },
      webNavigation: { onCommitted: event(), onHistoryStateUpdated: event() },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      runtime: { onMessage: event(), onStartup: event(), getManifest: () => ({ version: "0.9.5" }) },
      commands: { onCommand: event() },
    },
  });
  runInContext(source, context);
  return { data, writes, captures, context, interceptSet(fn) { beforeSet = fn; },
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
