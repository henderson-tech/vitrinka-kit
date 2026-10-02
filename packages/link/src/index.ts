/**
 * @vitrinka/link — the device link that mints an ingest-only recorder token.
 *
 * Doors live at the ORIGIN of the configured base (a base may be
 * `https://app.vitrinka.ai/w/acme`; the link doors sit at the apex):
 *
 *   POST {origin}/api/v1/cli/auth        {kind:"recorder", label}
 *     → 201 {device_code, user_code, verify_path, verify_url?, qr_path, interval, expires_in}
 *   POST {origin}/api/v1/cli/auth/claim  {device_code}
 *     → 202 pending · 200 {token, kind, workspace, label, expires_in} · 404 expired
 *
 * A base that addresses one workspace (`…/w/<slug>`) carries that slug as a
 * `workspace=<slug>` hint on the approve and QR URLs (the approve page
 * preselects it) and refuses a claim pinned to any other workspace — its
 * token could never authenticate against `/w/<slug>`.
 *
 * Pure TypeScript: no DOM or React Native globals — `fetch` is taken from
 * the options or from globalThis.
 */

export interface LinkStart {
  /** The base the link was started for (its origin serves the doors). */
  base: string;
  device_code: string;
  /** The code the tester types/sees, e.g. `ABCD-EFGH`. */
  user_code: string;
  verify_path: string;
  /** Absolute approval URL — same-device path. */
  verifyUrl: string;
  /** Absolute URL of the server-rendered QR (SVG) — other-device path. */
  qrUrl: string;
  /** Poll interval in seconds (never below 2). */
  interval: number;
  expires_in: number;
}

export interface Linked {
  token: string;
  /** Slug of the workspace the approver pinned the token to. */
  workspace: string;
  label: string;
  /** Seconds until the (sliding) token expiry, as of the claim. */
  expires_in: number;
}

/** The server no longer knows the code (expired or already consumed). */
export class LinkExpired extends Error {
  constructor(message = 'link code expired') {
    super(message);
    this.name = 'LinkExpired';
  }
}

/**
 * The approver pinned the token to another workspace than the one the
 * recorder records into. The token is discarded (never returned): every
 * session door under `/w/<expected>` would answer it with a 401.
 */
export class LinkWorkspaceMismatch extends Error {
  constructor(
    readonly linked: string,
    readonly expected: string,
  ) {
    super(`linked into ${linked} — this app records into ${expected}; link again and pick ${expected}`);
    this.name = 'LinkWorkspaceMismatch';
  }
}

export class LinkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'LinkError';
  }
}

/**
 * Transport-status vocabulary shared by every recorder (web, Expo) — ONE copy,
 * here in the zero-dependency package both already depend on, so a change to
 * the retry rule cannot drift between them.
 */
export class VitrinkaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'VitrinkaApiError';
  }
}

/** A server verdict retrying can never fix (4xx minus timeout/rate-limit). */
export function permanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

type Fetch = typeof globalThis.fetch;

export interface LinkOptions {
  fetch?: Fetch;
}

/** The control-plane origin of a base URL. */
export function linkOrigin(base: string): string {
  return new URL(base).origin;
}

/**
 * The workspace a base URL addresses — `<slug>` of a `/w/<slug>` path, split
 * exactly like the server's tenant router — or undefined for a bare origin.
 */
export function linkWorkspace(base: string): string | undefined {
  const m = /^\/w\/([^/]+)/.exec(new URL(base).pathname);
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function withWorkspace(url: string, workspace: string | undefined): string {
  if (!workspace) return url;
  const u = new URL(url);
  u.searchParams.set('workspace', workspace);
  return u.href;
}

/** A 401 from a session door: the stored token is dead. */
export function isUnauthorized(status: number): boolean {
  return status === 401;
}

function fetcher(opts: LinkOptions): Fetch {
  const f = opts.fetch ?? globalThis.fetch;
  if (typeof f !== 'function') throw new Error('vitrinka link: no fetch available');
  return f;
}

interface StartWire {
  device_code: string;
  user_code: string;
  verify_path: string;
  verify_url?: string;
  qr_path: string;
  interval?: number;
  expires_in?: number;
}

/**
 * Resolve a server-supplied path or URL against the link origin and accept it
 * ONLY when it lands on that same origin over http(s). The result is rendered
 * as a clickable href and an <img src>, so a compromised or misconfigured
 * server must not be able to point the tester's tap or the QR anywhere else.
 * Anything off-origin, non-http or unparsable falls back to the origin's own
 * path (or, when even that is unusable, to the given default).
 */
function sameOriginUrl(origin: string, candidate: string | undefined, fallbackPath: string, defaultPath: string): string {
  const own = (v: string | undefined): string | undefined => {
    if (!v) return undefined;
    try {
      const u = new URL(v, origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
      if (u.origin === origin) return u.href;
      // Same path, OUR origin: a server that answered with another host's URL
      // still gets the tap and the QR pointed at the deployment we linked to.
      return origin + u.pathname + u.search;
    } catch {
      return undefined;
    }
  };
  return own(candidate) ?? own(fallbackPath) ?? origin + defaultPath;
}

function requireString(w: Record<string, unknown>, key: string, status: number): string {
  const v = w[key];
  if (typeof v !== 'string' || v === '') throw new LinkError(`link start → malformed payload (${key})`, status);
  return v;
}

/**
 * Ask the server for a link code. `workspace` (normally `linkWorkspace(base)`)
 * rides the approve and QR URLs as a preselect hint only — the start body
 * stays `{kind, label}`, because the server refuses unknown fields there.
 */
export async function startLink(base: string, opts: { label: string; workspace?: string } & LinkOptions): Promise<LinkStart> {
  const origin = linkOrigin(base);
  const res = await fetcher(opts)(`${origin}/api/v1/cli/auth`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'recorder', label: opts.label }),
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new LinkError(`link start → ${res.status}`, res.status);
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new LinkError('link start → malformed payload (not JSON)', res.status);
  }
  if (typeof raw !== 'object' || raw === null) throw new LinkError('link start → malformed payload', res.status);
  const w = raw as Record<string, unknown> & Partial<StartWire>;
  const deviceCode = requireString(w, 'device_code', res.status);
  const userCode = requireString(w, 'user_code', res.status);
  const verifyPath = requireString(w, 'verify_path', res.status);
  const qrPath = requireString(w, 'qr_path', res.status);
  return {
    base,
    device_code: deviceCode,
    user_code: userCode,
    verify_path: verifyPath,
    verifyUrl: withWorkspace(
      sameOriginUrl(origin, typeof w.verify_url === 'string' ? w.verify_url : undefined, verifyPath, `/cli-auth?code=${encodeURIComponent(userCode)}`),
      opts.workspace,
    ),
    qrUrl: withWorkspace(sameOriginUrl(origin, qrPath, qrPath, `/cli-auth/qr?code=${encodeURIComponent(userCode)}`), opts.workspace),
    interval: Math.max(2, Number(w.interval) || 2),
    expires_in: Number(w.expires_in) || 0,
  };
}

export interface PollOptions extends LinkOptions {
  /** Seconds between claims (min 2). */
  interval?: number;
  /**
   * Seconds the code lives (`LinkStart.expires_in`): transient claim failures
   * are retried until then. Omitted or 0 → the server's code TTL (600).
   */
  expiresIn?: number;
  /** The workspace the recorder records into; a claim pinned elsewhere rejects with LinkWorkspaceMismatch. */
  workspace?: string;
  signal?: AbortSignal;
  /** Test seam: the sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Test seam: the clock (epoch ms). */
  now?: () => number;
}

/** The server's link-code TTL, assumed when the start answer named none. */
const CODE_TTL_S = 600;
/** Ceiling of the backoff between claims that failed transiently. */
const MAX_BACKOFF_MS = 30_000;

/** A claim answer worth retrying: the edge or the server hiccuped, or asked us to slow down. */
function transientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * `Retry-After` in ms (delta-seconds or an HTTP date), when the answer
 * carries one. Cross-origin it is only readable when the server exposes it;
 * otherwise the backoff alone paces the retry.
 */
function retryAfterMs(res: Response, now: number): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      res();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      rej(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error('link polling aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Claim until approved. Resolves with the token; throws LinkExpired on 404
 * (or once the code's own expiry passes), LinkWorkspaceMismatch when approved
 * into another workspace than `opts.workspace`, LinkError on any other
 * definitive refusal, AbortError on abort.
 *
 * A claim that fails transiently — the fetch rejects with a network
 * TypeError (offline, an edge reset, a CORS-less error page), or answers
 * 5xx, 408 or 429 — never ends the link: the next claim waits a doubling
 * backoff (capped at 30s, at least any readable `Retry-After`) and the
 * pending cadence resumes on the next 202.
 */
export async function pollLink(base: string, deviceCode: string, opts: PollOptions = {}): Promise<Linked> {
  const origin = linkOrigin(base);
  const f = fetcher(opts);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const interval = Math.max(2, opts.interval ?? 2);
  const deadline = now() + (opts.expiresIn && opts.expiresIn > 0 ? opts.expiresIn : CODE_TTL_S) * 1000;
  let failures = 0;
  /** Back off after a transient failure, or give up once the code has expired anyway. */
  const backOff = async (cause: string, retryAfter?: number) => {
    failures++;
    const wait = Math.max(Math.min(MAX_BACKOFF_MS, interval * 1000 * 2 ** failures), retryAfter ?? 0);
    if (now() + wait >= deadline) throw new LinkExpired(`link code expired (last claim: ${cause})`);
    await sleep(wait, opts.signal);
  };
  for (;;) {
    if (opts.signal?.aborted) throw abortError();
    let res: Response;
    try {
      res = await f(`${origin}/api/v1/cli/auth/claim`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_code: deviceCode }),
        signal: opts.signal,
      });
    } catch (e) {
      // fetch rejects with a TypeError for every network-level failure; an
      // abort (ours) or anything else is not a hiccup and propagates.
      if (opts.signal?.aborted || !(e instanceof TypeError)) throw e;
      await backOff(e.message);
      continue;
    }
    if (transientStatus(res.status)) {
      await backOff(String(res.status), retryAfterMs(res, now()));
      continue;
    }
    failures = 0;
    if (res.status === 200) {
      const linked = (await res.json()) as Linked;
      // Fail closed: a recorder claim always names its workspace (the server
      // sets it for kind recorder), so a missing or non-string one is refused
      // like a foreign one — never stored against a base it cannot serve.
      if (opts.workspace && linked.workspace !== opts.workspace) {
        const got = typeof linked.workspace === 'string' && linked.workspace ? linked.workspace : '(no workspace)';
        throw new LinkWorkspaceMismatch(got, opts.workspace);
      }
      return linked;
    }
    if (res.status === 404 || res.status === 410) throw new LinkExpired();
    if (res.status !== 202) throw new LinkError(`link claim → ${res.status}`, res.status);
    await sleep(interval * 1000, opts.signal);
  }
}
