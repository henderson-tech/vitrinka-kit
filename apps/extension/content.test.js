import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("./content.js", import.meta.url), "utf8");
// @vitrinka/web's ONE recorder codec, as the worker injects it ahead of content.js.
const oneCodec = readFileSync(new URL("./vendor/vitrinka-one.iife.js", import.meta.url), "utf8");
const LEAD = "data-vitrinka-lead";

// `<html>`: the one element whose attributes the ONE recorder reads and writes.
function htmlRoot(attrs = {}) {
  const map = new Map(Object.entries(attrs));
  return {
    getAttribute: (n) => (map.has(n) ? map.get(n) : null),
    setAttribute: (n, v) => { map.set(n, String(v)); },
    removeAttribute: (n) => { map.delete(n); },
    hasAttribute: (n) => map.has(n),
    append() {},
  };
}

// `inject` is the claim the worker hands in (__vitrinkaInject); `attrs`, what
// <html> carries before the script runs (a page recorder's mark, its claim).
function recorder(policy, { inject = null, attrs = {}, status = {} } = {}) {
  const messages = [], listeners = [], records = [], intervals = new Map();
  const documentListeners = new Map();
  const bus = new EventTarget();
  const html = htmlRoot(attrs);
  const runtime = { id: "synthetic-extension" };
  let timer = 0, controller, unmounted = false;
  class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((bytes) => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  }
  class Element {
    constructor(tagName = "DIV") {
      this.tagName = tagName;
      this.style = {};
      this.dataset = {};
      this.classList = { length: 0, add() {}, toggle() {} };
      this.innerText = "";
      this.value = "";
    }
    getAttribute() { return null; }
    closest(selector) { return selector.startsWith("[data-vitrinka-recorder]") || selector.startsWith(".rr-") ? null : this; }
    querySelector() { return null; }
    contains() { return false; }
    setAttribute() {}
    removeAttribute() {}
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 30 }; }
    attachShadow() { return { querySelector: () => new Element() }; }
    addEventListener() {}
    append() {}
    remove() {}
  }
  const context = createContext({
    Element, console, Blob, Date, crypto, queueMicrotask,
    MutationObserver: class { observe() {} disconnect() {} },
    FileReader,
    EventTarget, Event, CustomEvent,
    VitrinkaHud: { mount: (adapter) => { controller = adapter; return () => { unmounted = true; }; } },
    window: { devicePixelRatio: 1, innerWidth: 1440 },
    location: { pathname: "/", href: "https://example.test/" },
    document: {
      createElement: () => new Element(),
      documentElement: html,
      querySelectorAll: () => [],
      addEventListener: (name, listener) => documentListeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (documentListeners.get(name) === listener) documentListeners.delete(name);
      },
    },
    // `window`'s events: where the ONE recorder's hello / command / ack travel.
    addEventListener: (...a) => bus.addEventListener(...a),
    removeEventListener: (...a) => bus.removeEventListener(...a),
    dispatchEvent: (e) => bus.dispatchEvent(e),
    setInterval: (fn) => { intervals.set(++timer, fn); return timer; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: () => ++timer, clearTimeout() {},
    rrwebRecord: (opts) => {
      const record = { opts, stopped: false };
      records.push(record);
      return () => { record.stopped = true; };
    },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: Object.assign(runtime, {
      getManifest: () => ({ version: "0.9.5" }),
      sendMessage: (msg, callback) => {
        messages.push(msg);
        callback(msg.type === "vt-policy" ? policy : msg.type === "vt-status" ? { ok: true, rec: { sessionId: 1, startedAt: new Date().toISOString(), ...status } } : { ok: true });
      },
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    }) },
  });
  runInContext(oneCodec, context);
  return {
    messages, records, listeners, html, runtime, intervals, documentListeners,
    get controller() { return controller; },
    get unmounted() { return unmounted; },
    get claim() { return JSON.parse(html.getAttribute(LEAD) || "null"); },
    // The page recorder's side of the channel: the same codec over this document.
    one: context.VitrinkaOne,
    env: { root: html, bus },
    hud(hud) { for (const listener of [...listeners]) listener({ type: "vt-hud", hud }, {}, () => {}); },
    async start(nextPolicy = policy) {
      policy = nextPolicy;
      context.__vitrinkaInject = inject;
      const result = runInContext(source, context);
      // Shared HUD initialization settles before rrweb starts its snapshot.
      for (let i = 0; i < 12; i++) await Promise.resolve();
      return result;
    },
    async stop() {
      for (const listener of [...listeners]) listener({ type: "vt-stop" }, {}, () => {});
      await Promise.resolve();
    },
    click(tag, value, text = "") {
      const el = new Element(tag);
      el.value = value;
      el.innerText = text;
      documentListeners.get("click")?.({ target: el });
      return messages.filter((msg) => msg.type === "vt-click").at(-1)?.payload.text;
    },
  };
}

const masked = { ok: true, mask: { maskAllInputs: true, maskAllText: false }, pixel: "none" };

test("click capture masks entered values before messaging but retains button labels", async () => {
  const rec = recorder(masked);
  await rec.start();
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    expect(rec.click(tag, "plain-private-value", tag === "SELECT" ? "private option" : "")).toBe("[redacted]");
  }
  expect(rec.click("BUTTON", "", "Save")).toBe("Save");
  const full = recorder({ ok: true, mask: { maskAllInputs: false, maskAllText: false }, pixel: "none" });
  await full.start();
  expect(full.click("INPUT", "explicit-full-fidelity")).toBe("explicit-full-fidelity");
});

test("missing or failed policy responses mask all DOM text and click labels", async () => {
  for (const policy of [null, undefined, { ok: false }, { ok: true }]) {
    const rec = recorder(policy);
    await rec.start();
    expect(rec.records[0].opts.maskAllInputs).toBe(true);
    expect(rec.records[0].opts.maskAllText).toBe(true);
    expect(rec.records[0].opts.maskTextSelector).toBe("*");
    expect(rec.click("BUTTON", "", "private label")).toBe("[redacted]");
  }
});

test("stop retires rrweb and its message listener before a stricter session starts", async () => {
  const rec = recorder({ ok: true, mask: { maskAllInputs: false, maskAllText: false }, pixel: "none" });
  await rec.start();
  await rec.stop();
  expect(rec.records[0].stopped).toBe(true);
  expect(rec.listeners).toHaveLength(0);
  rec.records[0].opts.emit({ type: 3, data: { text: "off-record private text" } });
  await rec.start({ ok: true, mask: { maskAllInputs: true, maskAllText: true }, pixel: "blur" });
  rec.records[1].opts.emit({ type: 3, data: { text: "***" } });
  await rec.stop();
  expect(rec.messages.filter((msg) => msg.type === "vt-rrweb").flatMap((msg) => msg.events))
    .toEqual([{ type: 3, data: { text: "***" } }]);
});

test("HUD canAttach requires an explicit true capability", async () => {
  const rec = recorder(masked); await rec.start();
  for (const canAttach of [true, false, undefined]) {
    rec.hud({ base: "https://synthetic.test", workspace: "qa", recents: [], prefs: {}, canAttach });
    expect(rec.controller.getSnapshot().canAttach).toBe(canAttach === true);
  }
});

test("note serializes attachment blobs as JSON-safe data URLs", async () => {
  const rec = recorder(masked); await rec.start();
  rec.controller.note("Plain");
  expect(rec.messages.at(-1)).toMatchObject({ type: "vt-note", payload: { text: "Plain" } });
  rec.controller.note("Reference", [{ name: "expected.png", blob: new Blob(["pixels"], { type: "image/png" }), w: 20, h: 10 }]);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(JSON.parse(JSON.stringify(rec.messages.at(-1)))).toMatchObject({ type: "vt-note", attachments: [{ name: "expected.png", dataUrl: "data:image/png;base64,cGl4ZWxz", w: 20, h: 10 }] });
});

test("annotate serializes attachments beside the vt-snap payload", async () => {
  const rec = recorder(masked); await rec.start();
  rec.controller.annotate({ text: "Reference", rect: { x: 1, y: 2, w: 3, h: 4 }, selector: "button", task: true,
    attachments: [{ name: "expected.webp", blob: new Blob(["pixels"], { type: "image/webp" }), w: 20, h: 10 }] });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(JSON.parse(JSON.stringify(rec.messages.at(-1)))).toMatchObject({ type: "vt-snap", payload: { note: "Reference", task: true, rect: { x: 1, y: 2, w: 3, h: 4 } },
    attachments: [{ name: "expected.webp", dataUrl: "data:image/webp;base64,cGl4ZWxz", w: 20, h: 10 }] });
});

// ONE recorder (extension + page recorder decisions 2026-10-12).
const inject = { generation: "gen-1", sessionId: "1", state: "recording" };
const page = { from: "page", inst: "p.synthetic" };
const pageClaim = JSON.stringify({ v: 1, by: "page", id: "p.synthetic", state: "recording", sessionId: "42", since: 1 });

test("content.js claims its document under the recording's generation; where a live page recorder holds it, it yields and captures nothing", async () => {
  const held = recorder(masked, { inject, attrs: { [LEAD]: pageClaim, "data-vitrinka-page": "web/0.5.0" } });
  // The page recorder answers for its claim (D5).
  held.one.serveHello(held.env, page, () => ({ by: "page", state: "recording", here: true, id: page.inst }));
  expect(await held.start()).toBe("yield");
  expect(held.claim).toMatchObject({ by: "page", id: page.inst });
  expect(held.records).toHaveLength(0);
  expect(held.documentListeners.has("click")).toBe(false);
  expect(held.controller).toBeUndefined();
  expect(held.messages).toHaveLength(0);

  const free = recorder(masked, { inject, attrs: { "data-vitrinka-page": "web/0.5.0" } });
  expect(await free.start()).toBeUndefined();
  expect(free.claim).toMatchObject({ v: 1, by: "extension", id: "gen-1", state: "recording", sessionId: "1" });
  // A page asking who records hears this script, synchronously, under the claim's id.
  expect(free.one.holderAnswers(free.env, page, free.claim)).toBe(true);
});

test("a page recorder's pause, note and stop act on the extension's recording inside their dispatch; a stop elsewhere releases the claim", async () => {
  const rec = recorder(masked, { inject });
  await rec.start();
  const command = (op, text) => rec.one.sendCommand(rec.env, page, op, text);
  expect(command("pause")).toMatchObject({ ok: true, from: "extension" });
  expect(rec.messages.at(-1)).toEqual({ type: "vt-pause", generation: "gen-1" });
  expect(command("note", "  from the page  ")).toMatchObject({ ok: true });
  expect(rec.messages.at(-1)).toMatchObject({ type: "vt-note", payload: { text: "from the page" } });
  expect(command("note", " ")).toMatchObject({ ok: false, code: "bad_command" });
  let stops = 0;
  rec.controller.onRemoteStop(() => { stops++; });
  expect(command("stop")).toMatchObject({ ok: true });
  expect(stops).toBe(1);
  // Another tab's Stop ended the recording: the claim goes, nobody answers.
  await rec.stop();
  expect(rec.claim).toBeNull();
  expect(command("pause")).toBeNull();
});

test("the stopping pill holds the claim as saved while its face shows, then lets go — and steps aside where a page recorder lives", async () => {
  const rec = recorder(masked, { inject, attrs: { "data-vitrinka-page": "web/0.5.0" } });
  await rec.start();
  rec.controller.faceChanged("saving");
  // The synthetic worker closes nothing: the stop ends locally, its face stays up.
  await rec.controller.stop().catch(() => undefined);
  expect(rec.claim).toMatchObject({ by: "extension", id: "gen-1", state: "saved" });
  rec.controller.faceChanged("failed");
  expect(rec.claim.state).toBe("saved");
  expect(rec.unmounted).toBe(false);
  rec.controller.faceChanged("none");
  expect(rec.claim).toBeNull();
  expect(rec.unmounted).toBe(true);
});

test("an orphaned script (extension reloaded) answers nothing, lets go of its claim and unmounts its pill", async () => {
  const rec = recorder(masked, { inject, attrs: { "data-vitrinka-page": "web/0.5.0" } });
  await rec.start();
  const claim = rec.claim;
  delete rec.runtime.id;
  expect(rec.one.holderAnswers(rec.env, page, claim)).toBe(false);
  expect(rec.claim).toBeNull();
  expect(rec.unmounted).toBe(true);
  expect(rec.records[0].stopped).toBe(true);
});

test("a document injected while the recording is paused starts rrweb only at the resume", async () => {
  const rec = recorder(masked, { inject: { ...inject, state: "paused" }, status: { paused: true } });
  await rec.start();
  expect(rec.records).toHaveLength(0);
  for (const listener of [...rec.listeners]) listener({ type: "vt-paused", paused: false, elapsedMs: 0 }, {}, () => {});
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(rec.records).toHaveLength(1);
  // Resumed between the bootstrap and the script: the status it adopts starts rrweb.
  const resumedMeanwhile = recorder(masked, { inject: { ...inject, state: "paused" } });
  await resumedMeanwhile.start();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  expect(resumedMeanwhile.records).toHaveLength(1);
});

test("the same recording re-injected takes back a document claim a refused replacing Start left empty", async () => {
  const rec = recorder(masked, { inject });
  await rec.start();
  rec.html.removeAttribute(LEAD);
  await rec.start();
  expect(rec.claim).toMatchObject({ by: "extension", id: "gen-1", state: "recording" });
  expect(rec.records).toHaveLength(1);
});

test("a recording a Start replaced retires its instance in every tab it captured: claim, capture and pill", async () => {
  const rec = recorder(masked, { inject });
  await rec.start();
  for (const listener of [...rec.listeners]) listener({ type: "vt-retire", generation: "gen-0" }, {}, () => {});
  expect(rec.claim).toMatchObject({ id: "gen-1" });
  for (const listener of [...rec.listeners]) listener({ type: "vt-retire", generation: "gen-1" }, {}, () => {});
  expect(rec.claim).toBeNull();
  expect(rec.unmounted).toBe(true);
  expect(rec.records[0].stopped).toBe(true);
  expect(rec.listeners).toHaveLength(0);
});
