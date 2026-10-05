/**
 * Network capture — JS-level fetch + XHR monkey-patch (design decision).
 *
 * A consuming app's API client may ride axios, which uses XHR on RN — that patch
 * carries the API waterfall. The fetch patch covers manual fetches. Bodies
 * are captured whole up to BODY_CAP (D7 capture-everything: recording is
 * opt-in per session and the tester chooses what to record; nothing leaves the
 * device except to the configured vitrinka host); native-level requests (image
 * loads, native SDKs) are out of scope.
 *
 * Recorder's own vitrinka traffic is excluded to avoid feedback loops.
 * Patches observe only — errors in capture code must never break the app's
 * request, and responses are never consumed (XHR reads responseText after
 * completion; fetch clones).
 */
import { isVitrinkaUrl } from '../api';
import { getState, pushEvent, trackCapture } from '../queue';
import { currentRoute } from '../state';
import { redactAndCap, redactHeaders, redactUrl } from './redact';

const BODY_CAP = 64 * 1024;
/**
 * Responses larger than this are recorded WITHOUT their body. `capBody` can
 * only slice a string that was already materialized, so the cap alone does not
 * bound decode/allocation work — the length check does.
 */
const BODY_READ_LIMIT = 512 * 1024;
/**
 * Wall-clock bound on a single body read. Keeps a streaming/stalled response
 * from pinning a capture (and therefore Stop) open indefinitely.
 */
let BODY_READ_DEADLINE_MS = 3000;

/** Test-only: shorten the read deadline so suites don't burn real seconds. */
export function __setBodyReadDeadlineForTests(ms: number): () => void {
  const prev = BODY_READ_DEADLINE_MS;
  BODY_READ_DEADLINE_MS = ms;
  return () => {
    BODY_READ_DEADLINE_MS = prev;
  };
}

/** Is a session actively capturing right now? Gates all body work. */
function capturing(): boolean {
  return activeSessionId() !== null;
}

/** Id of the capturing session, else null (paused AND dead count as null). */
function activeSessionId(): string | null {
  const rec = getState();
  return rec !== null && !rec.paused && !rec.dead ? rec.sessionId : null;
}

/**
 * Is `id` STILL the capturing session? In-flight requests must be bound to the
 * session they started in: a request begun in session A that completes after A
 * stopped and B started would otherwise be appended to B, with B's route
 * attached.
 */
function stillCapturing(id: string | null): boolean {
  return id !== null && activeSessionId() === id;
}

/**
 * Redact + cap in the shape-appropriate ORDER — see `redactAndCap`
 *.
 */
function capBody(body: unknown, contentType?: string): string | undefined {
  if (typeof body !== 'string') return undefined;
  return redactAndCap(body, BODY_CAP, contentType);
}

/** Content-type from a raw (pre-redaction) header object, '' when absent. */
function ctOf(h: Record<string, string> | undefined): string {
  for (const [k, v] of Object.entries(h ?? {})) {
    if (k.toLowerCase().replace(/[-_]/g, '') === 'contenttype') return v;
  }
  return '';
}

/** Narrow a RequestInfo to its object form for property access. */
function init0(input: RequestInfo | URL): object {
  return typeof input === 'string' || input instanceof URL ? {} : input;
}

function recordNet(payload: Record<string, unknown>): void {
  // Query strings carry secrets too (?token=…, ?otp=…) — redact the URL
  // centrally, with the engine's dedicated URL scrub (query AND fragment,
  // split on both `&` and `;`).
  const url = typeof payload.url === 'string' ? redactUrl(payload.url) : payload.url;
  pushEvent('net', { ...payload, url }, { ...currentRoute });
}

/**
 * Normalize any HeadersInit shape (Headers, pair array, plain record) into a
 * plain object for the redaction engine. Returns undefined when there is
 * nothing to record; never throws — header capture must not break a request.
 */
function headersToObject(h: unknown): Record<string, string> | undefined {
  if (!h) return undefined;
  try {
    const out: Record<string, string> = {};
    const headers = h as {
      forEach?: (cb: (value: string, key: string) => void) => void;
    };
    if (typeof headers.forEach === 'function') {
      // Headers instance (also covers Maps and arrays via their forEach shapes
      // differing — arrays are handled below instead).
      if (Array.isArray(h)) {
        for (const pair of h as [string, string][]) {
          if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
        }
      } else {
        headers.forEach((value, key) => {
          out[key] = String(value);
        });
      }
    } else if (typeof h === 'object') {
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
        out[k] = String(v);
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

/** RAW request headers for a fetch call (init wins over Request) — redact before recording. */
function rawFetchReqHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, string> | undefined {
  const fromInit = headersToObject(init?.headers);
  if (fromInit) return fromInit;
  const obj = init0(input) as { headers?: unknown };
  return headersToObject(obj.headers);
}

/** Parse XHR's getAllResponseHeaders() CRLF block into a plain object. */
function parseRawHeaders(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Release a clone we are not going to read. Every early return MUST call this:
 * an abandoned clone keeps its tee branch buffering the entire response
 *.
 */
function discard(clone: Response): void {
  try {
    const body = (clone as Response & { body?: ReadableStream<Uint8Array> | null }).body;
    void body?.cancel?.().catch(() => undefined);
  } catch {
    // nothing to release
  }
}

/** Declared body size when the server sent one, else null. */
function declaredLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a response body with a HARD byte bound in every path.
 *
 * - declared length over the limit → never read at all;
 * - streamable body → read chunk-by-chunk and stop at the limit, so a chunked
 *   or compressed (length-less) response can no longer buffer without bound;
 * - no stream support and no declared length → omit the body rather than risk
 *   an unbounded `text()`.
 *
 * Always reads from a CLONE, so the app's own consumption of `res` is untouched.
 */
async function readBoundedBody(clone: Response, headers: Headers): Promise<string | undefined> {
  const raw = await readBoundedText(clone, headers);
  if (raw === undefined) return undefined;
  let ct = '';
  try {
    ct = headers.get('content-type') ?? '';
  } catch {
    // stubbed Headers without get() — the engine falls back to shape sniffing
  }
  return capBody(raw, ct);
}

/**
 * The BOUNDED read itself, returning raw text. Split from the capping wrapper so
 * the bound can be asserted directly: every observable path in `readBoundedBody`
 * runs through `capBody`, which caps to 64 KiB regardless of how much was read —
 * a test on the recorded body cannot tell a bounded read from an unbounded one
 *.
 */
async function readBoundedText(clone: Response, headers: Headers): Promise<string | undefined> {
  const size = declaredLength(headers);
  if (size !== null && size > BODY_READ_LIMIT) {
    // Abandoning the clone unread leaves its tee branch buffering the whole
    // body in memory — cancel it.
    discard(clone);
    return `[body omitted: ${size} bytes]`;
  }
  const stream = (clone as Response & { body?: ReadableStream<Uint8Array> | null }).body;
  if (stream?.getReader) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    let stalled = false;
    const readDeadline = Date.now() + BODY_READ_DEADLINE_MS;
    try {
      while (total < BODY_READ_LIMIT) {
        // A long-lived stream (SSE/NDJSON) or a stalled connection reaches
        // neither EOF nor the byte bound, which would keep this capture — and
        // therefore Stop — waiting indefinitely.
        const left = readDeadline - Date.now();
        if (left <= 0) {
          stalled = true;
          break;
        }
        // The deadline timer MUST be cleared when the read wins, or every loop
        // iteration leaves a live timer behind — a length-less response yielding
        // tiny chunks could strand hundreds of thousands of them
        //.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          reader.read(),
          new Promise<'timeout'>((res) => {
            timer = setTimeout(() => res('timeout'), left);
          }),
        ]).finally(() => {
          if (timer !== undefined) clearTimeout(timer);
        });
        if (next === 'timeout') {
          stalled = true;
          break;
        }
        const { done, value } = next;
        if (done) break;
        if (value) {
          // Slice to the REMAINING allowance: a single multi-megabyte chunk
          // would otherwise push total (and the joined allocation) arbitrarily
          // past the advertised bound.
          const room = BODY_READ_LIMIT - total;
          const part = value.byteLength > room ? value.subarray(0, room) : value;
          chunks.push(part);
          total += part.byteLength;
        }
      }
      // Stop pulling once the bound is hit; the rest of the body is discarded.
      truncated = total >= BODY_READ_LIMIT;
      void reader.cancel().catch(() => undefined);
    } catch {
      return undefined;
    }
    const joined = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      joined.set(c, at);
      at += c.byteLength;
    }
    let text: string;
    try {
      text = new TextDecoder().decode(joined);
    } catch {
      return `[body omitted: ${total} bytes, undecodable]`;
    }
    if (stalled) return `${text}…[body read timed out after ${BODY_READ_DEADLINE_MS}ms]`;
    return truncated ? `${text}…[truncated at ${BODY_READ_LIMIT} bytes]` : text;
  }
  // No stream API (RN's fetch polyfill): only safe when the length is known.
  if (size === null) {
    discard(clone);
    return '[body omitted: length-less response, no stream API]';
  }
  try {
    return await clone.text();
  } catch {
    return undefined;
  }
}

/** Test-only: the RAW bounded read, before capping — see `readBoundedText`. */
export function __readBoundedTextForTests(clone: Response, headers: Headers) {
  return readBoundedText(clone, headers);
}

/**
 * The patched flag lives on globalThis, NOT in module scope: Fast Refresh can
 * re-evaluate this module, which would reset a module-level boolean and stack a
 * second patch on top of the first — double-recording every request and
 * unbounded wrapper nesting across reloads. Keyed by a
 * string so a re-evaluated module sees the previous evaluation's mark.
 */
const PATCH_MARK = '__vitrinkaRecorderNetPatched';

/** Per-XHR capture metadata, stashed on the instance between open() and loadend. */
interface VtMeta {
  method: string;
  url: string;
  reqHeaders?: Record<string, string>;
}

export function patchNetwork(): void {
  const g = globalThis as typeof globalThis & { [PATCH_MARK]?: boolean };
  if (g[PATCH_MARK]) return;
  g[PATCH_MARK] = true;

  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Not recording (or recorder's own traffic) → pass straight through: no
    // clone, no body read, zero added cost.
    const origin = activeSessionId();
    if (isVitrinkaUrl(url) || origin === null) return origFetch(input, init);
    const method =
      init?.method ??
      ('method' in init0(input) ? (init0(input) as { method: string }).method : 'GET');
    const started = Date.now();
    try {
      const res = await origFetch(input, init);
      const ms = Date.now() - started;
      // Clone SYNCHRONOUSLY (before the caller can consume the body), then read
      // and record OFF the caller's critical path: awaiting the body read here
      // delayed the app's own `await fetch(...)` by however long the recorder
      // took to pull up to 512 KiB.
      let clone: Response | undefined;
      try {
        clone = res.clone();
      } catch {
        clone = undefined; // opaque/consumed body — never disturb the original
      }
      const headers = res.headers;
      const status = res.status;
      trackCapture(
        (async () => {
          // Re-check AFTER the await, and require the SAME session — the run may
          // have been paused/stopped meanwhile.
          if (!stillCapturing(origin)) return;
          const resBody = clone ? await readBoundedBody(clone, headers) : undefined;
          if (!stillCapturing(origin)) return;
          const rawReqHeaders = rawFetchReqHeaders(input, init);
          recordNet({
            method,
            url,
            status,
            ms,
            reqHeaders: redactHeaders(rawReqHeaders),
            resHeaders: redactHeaders(headersToObject(headers)),
            reqBody: capBody(init?.body, ctOf(rawReqHeaders)),
            resBody,
            via: 'fetch',
          });
        })(),
      );
      return res;
    } catch (e) {
      if (stillCapturing(origin)) {
        recordNet({ method, url, error: String(e), ms: Date.now() - started, via: 'fetch' });
      }
      throw e;
    }
  };

  const XHR = globalThis.XMLHttpRequest;
  // A runtime without XHR (or a stubbed one) must not take the recorder down —
  // patchNetwork() runs during provider mount, so a throw here would break the
  // whole app tree, not just capture.
  if (!XHR?.prototype) return;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  const origSetHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest['open']>
  ) {
    (this as XMLHttpRequest & { __vt?: VtMeta }).__vt = {
      method: args[0],
      url: String(args[1]),
    };
    return origOpen.apply(this, args);
  };

  // Request headers are only observable at the call site — record them as the
  // app sets them (redaction happens at event build, against the live rules).
  // The original may be absent on a stubbed XHR; observing must survive that.
  XHR.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const meta = (this as XMLHttpRequest & { __vt?: VtMeta }).__vt;
    if (meta) (meta.reqHeaders ??= {})[name] = value;
    return origSetHeader?.call(this, name, value);
  };

  XHR.prototype.send = function (
    this: XMLHttpRequest,
    body?: Parameters<XMLHttpRequest['send']>[0],
  ) {
    const meta = (this as XMLHttpRequest & { __vt?: VtMeta }).__vt;
    const origin = activeSessionId();
    if (meta && !isVitrinkaUrl(meta.url) && origin !== null) {
      const started = Date.now();
      this.addEventListener('loadend', () => {
        // Re-check at COMPLETION, and require the SAME session: a pause/stop
        // mid-flight means no event is recorded (so reading responseText would
        // be waste), and a request that outlives its session must
        // not be attributed to the next one.
        if (!stillCapturing(origin)) return;
        let rawResHeaders: Record<string, string> | undefined;
        try {
          rawResHeaders = parseRawHeaders(this.getAllResponseHeaders());
        } catch {
          rawResHeaders = undefined;
        }
        let resBody: string | undefined;
        try {
          resBody =
            this.responseType === '' || this.responseType === 'text'
              ? capBody(this.responseText, ctOf(rawResHeaders))
              : undefined;
        } catch {
          resBody = undefined;
        }
        recordNet({
          method: meta.method,
          url: meta.url,
          status: this.status,
          ms: Date.now() - started,
          reqHeaders: redactHeaders(meta.reqHeaders),
          resHeaders: redactHeaders(rawResHeaders),
          reqBody: capBody(body, ctOf(meta.reqHeaders)),
          resBody,
          via: 'xhr',
        });
      });
    }
    return origSend.call(this, body);
  };
}
