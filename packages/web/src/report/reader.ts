/**
 * Reading back what the reporter sent (vt-8020 D4), on the widget's own
 * publishable key: the host's signed token is traded once for a short-lived
 * reporter session, which then lists the reporter's reports and their news.
 * A `vkb_` key alone reads nothing — every list call carries the session.
 * A browser linked to a vitrinka member on the widget's base proves the link
 * in the trade too (`memberToken`, vt-8020): the session then lists the
 * reporter's reports and the member's, as the server joins them.
 *
 *   POST /api/v1/report/session   {token, memberToken?} → {reporter, session, expiresAt, portalUrl?, memberError?}
 *   GET  /api/v1/report/mine?cursor=     X-Vitrinka-Reporter → {reports, nextCursor}
 *   GET  /api/v1/report/updates?cursor=  X-Vitrinka-Reporter → {updates, nextCursor}
 */
import { type ApiTarget, VitrinkaApiError } from '../recorder/api';
import { refusedField } from './wire';

export interface Reporter {
  id: string;
  email: string;
  name?: string;
}

export interface ReporterSession {
  reporter: Reporter;
  session: string;
  /** ISO time the session stops being accepted. */
  expiresAt: string;
  /** The project's reporter portal, when one is bound. */
  portalUrl?: string;
  /** The server did not take the member link the trade carried (revoked, another workspace, no longer a member); the session is the reporter's alone. */
  memberError?: string;
}

/** One of the reporter's reports, as the portal projects it. */
export interface MyReport {
  id: string;
  title: string;
  /** Received · Planned · In progress · Fixed · Done, as the server words the step key. */
  step: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface MyReports {
  reports: MyReport[];
  nextCursor?: string;
}

async function call<T>(method: string, path: string, target: ApiTarget, body?: unknown, session?: string): Promise<T> {
  const res = await fetch(target.url + path, {
    method,
    mode: 'cors',
    credentials: 'omit',
    headers: {
      authorization: `Bearer ${target.key}`,
      ...(session ? { 'x-vitrinka-reporter': session } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new VitrinkaApiError(`${method} ${path} → ${res.status}: ${text}`, res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Trade the host's token for a reporter session, proving `memberToken` beside
 * it when there is one. A vitrinka older than the field refuses it by name:
 * the session is the reporter's alone then, never lost — the trade goes again
 * without it, once.
 */
export async function openSession(target: ApiTarget, token: string, memberToken = ''): Promise<ReporterSession> {
  const path = '/api/v1/report/session';
  if (!memberToken) return call<ReporterSession>('POST', path, target, { token });
  try {
    return await call<ReporterSession>('POST', path, target, { token, memberToken });
  } catch (e) {
    if (refusedField(e) !== 'memberToken') throw e;
    console.warn('vitrinka: this server takes no member link yet — the reporter session opens without it');
    return call<ReporterSession>('POST', path, target, { token });
  }
}

/**
 * Whose session a widget holds: the host's signed token and the member link
 * the trade proved — '' without a host token, which opens none. Linking,
 * unlinking or relinking is another key, so another session and list.
 */
export function sessionKey(hostToken: string, memberToken: string): string {
  return hostToken ? JSON.stringify([hostToken, memberToken]) : '';
}

/** Still good for at least a minute more. */
export function sessionLive(s: ReporterSession | null, now = Date.now()): s is ReporterSession {
  return s !== null && Date.parse(s.expiresAt) - now > 60_000;
}

export function listMine(target: ApiTarget, session: string, cursor?: string): Promise<MyReports> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return call<MyReports>('GET', `/api/v1/report/mine${q}`, target, undefined, session);
}
