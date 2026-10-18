/**
 * Reading back what the reporter sent (vt-8020 D4), on the widget's own
 * publishable key: the host's signed token is traded once for a short-lived
 * reporter session, which then lists the reporter's reports and their news.
 * A `vkb_` key alone reads nothing — every list call carries the session.
 *
 *   POST /api/v1/report/session   {token} → {reporter, session, expiresAt, portalUrl?}
 *   GET  /api/v1/report/mine?cursor=     X-Vitrinka-Reporter → {reports, nextCursor}
 *   GET  /api/v1/report/updates?cursor=  X-Vitrinka-Reporter → {updates, nextCursor}
 */
import { type ApiTarget, VitrinkaApiError } from '../recorder/api';

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

export function openSession(target: ApiTarget, token: string): Promise<ReporterSession> {
  return call<ReporterSession>('POST', '/api/v1/report/session', target, { token });
}

/** Still good for at least a minute more. */
export function sessionLive(s: ReporterSession | null, now = Date.now()): s is ReporterSession {
  return s !== null && Date.parse(s.expiresAt) - now > 60_000;
}

export function listMine(target: ApiTarget, session: string, cursor?: string): Promise<MyReports> {
  const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return call<MyReports>('GET', `/api/v1/report/mine${q}`, target, undefined, session);
}
