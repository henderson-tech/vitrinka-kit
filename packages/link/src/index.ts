/**
 * @vitrinka/link — the device link that mints an ingest-only recorder token.
 *
 * Doors live at the ORIGIN of the configured base (a base may be
 * `https://app.vitrinka.ai/w/acme`; the link doors sit at the apex):
 *
 *   POST {origin}/api/v1/cli/auth        {kind:"recorder", label}
 *     → 201 {device_code, user_code, verify_path, verify_url?, qr_path, interval, expires_in}
 *   POST {origin}/api/v1/cli/auth/claim  {device_code}
 *     → 202 pending · 200 {token, workspace, label, expires_at} · 404 expired
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
  workspace: string;
  label: string;
  expires_at: string;
}

/** The server no longer knows the code (expired or already consumed). */
export class LinkExpired extends Error {
  constructor(message = 'link code expired') {
    super(message);
    this.name = 'LinkExpired';
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

/** Ask the server for a link code. */
export async function startLink(base: string, opts: { label: string } & LinkOptions): Promise<LinkStart> {
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
    verifyUrl: sameOriginUrl(origin, typeof w.verify_url === 'string' ? w.verify_url : undefined, verifyPath, `/cli-auth?code=${encodeURIComponent(userCode)}`),
    qrUrl: sameOriginUrl(origin, qrPath, qrPath, `/cli-auth/qr?code=${encodeURIComponent(userCode)}`),
    interval: Math.max(2, Number(w.interval) || 2),
    expires_in: Number(w.expires_in) || 0,
  };
}

export interface PollOptions extends LinkOptions {
  /** Seconds between claims (min 2). */
  interval?: number;
  signal?: AbortSignal;
  /** Test seam: the sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
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

/** Claim until approved. Resolves with the token; throws LinkExpired on 404, AbortError on abort. */
export async function pollLink(base: string, deviceCode: string, opts: PollOptions = {}): Promise<Linked> {
  const origin = linkOrigin(base);
  const f = fetcher(opts);
  const sleep = opts.sleep ?? defaultSleep;
  const interval = Math.max(2, opts.interval ?? 2);
  for (;;) {
    if (opts.signal?.aborted) throw abortError();
    const res = await f(`${origin}/api/v1/cli/auth/claim`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
      signal: opts.signal,
    });
    if (res.status === 200) return (await res.json()) as Linked;
    if (res.status === 404 || res.status === 410) throw new LinkExpired();
    if (res.status !== 202) throw new LinkError(`link claim → ${res.status}`, res.status);
    await sleep(interval * 1000, opts.signal);
  }
}
