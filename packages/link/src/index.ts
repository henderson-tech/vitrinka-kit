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

function join(origin: string, path: string): string {
  return path.startsWith('http') ? path : origin + (path.startsWith('/') ? path : `/${path}`);
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
  const w = (await res.json()) as StartWire;
  return {
    base,
    device_code: w.device_code,
    user_code: w.user_code,
    verify_path: w.verify_path,
    verifyUrl: w.verify_url ?? join(origin, w.verify_path),
    qrUrl: join(origin, w.qr_path),
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
