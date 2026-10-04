import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("./content.js", import.meta.url), "utf8");

function recorder(policy) {
  const messages = [], listeners = [], records = [], intervals = new Map();
  const documentListeners = new Map();
  let timer = 0;
  class Element {
    constructor(tagName = "DIV") {
      this.tagName = tagName;
      this.style = {};
      this.classList = { length: 0, add() {}, toggle() {} };
      this.innerText = "";
      this.value = "";
    }
    getAttribute() { return null; }
    closest() { return this; }
    contains() { return false; }
    getBoundingClientRect() { return { x: 0, y: 0, width: 100, height: 30 }; }
    attachShadow() { return { querySelector: () => new Element() }; }
    addEventListener() {}
    append() {}
    remove() {}
  }
  const context = createContext({
    Element, console, Blob, Date,
    window: { devicePixelRatio: 1, innerWidth: 1440 },
    location: { pathname: "/", href: "https://example.test/" },
    document: {
      createElement: () => new Element(),
      documentElement: new Element(),
      addEventListener: (name, listener) => documentListeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (documentListeners.get(name) === listener) documentListeners.delete(name);
      },
    },
    addEventListener() {}, removeEventListener() {},
    setInterval: (fn) => { intervals.set(++timer, fn); return timer; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: () => ++timer, clearTimeout() {},
    rrwebRecord: (opts) => {
      const record = { opts, stopped: false };
      records.push(record);
      return () => { record.stopped = true; };
    },
    chrome: { runtime: {
      sendMessage: (msg, callback) => {
        messages.push(msg);
        callback(msg.type === "vt-policy" ? policy : { ok: true });
      },
      onMessage: {
        addListener: (listener) => listeners.push(listener),
        removeListener: (listener) => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    } },
  });
  return {
    messages, records, listeners,
    async start(nextPolicy = policy) {
      policy = nextPolicy;
      runInContext(source, context);
      await Promise.resolve();
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
