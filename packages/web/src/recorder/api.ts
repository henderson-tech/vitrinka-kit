/**
 * Vitrinka API client for the web journey recorder.
 *
 * Ingest contract, shared with the Expo recorder and the browser extension:
 *   GET   /api/v1/recorder/policy          workspace redaction policy + `attachments`
 *   GET   /api/v1/recorder/me              who the token is + HUD prefs (me.ts)
 *   PATCH /api/v1/recorder/me              {prefs}  (me.ts)
 *   POST  /api/v1/sessions                 {host, title, environment?, meta} → session
 *   POST  /api/v1/sessions/:id/events      {events: [...]}
 *   POST  /api/v1/sessions/:id/chunk?seq=N (rrweb batch body, application/json)
 *   POST  /api/v1/sessions/:id/shot?seq=N  (an attached image, its own Content-Type)
 *   POST  /api/v1/sessions/:id/tags        {tags}  (non-fatal)
 *   GET   /api/v1/sessions/:id             reconcile
 *   PATCH /api/v1/sessions/:id             {status: recording|paused|done}
 *
 * Every call: `authorization: Bearer <key>`, `credentials: "omit"` (the key
 * IS the credential; cookies never ride), `mode: "cors"`.
 */
import type { RedactionPolicy } from '@vitrinka/redact';

import { VitrinkaApiError } from './api-status';
import { isUnauthorized } from '@vitrinka/link';

import { bearerToken, recorderConfig } from './config';

export { permanentStatus, VitrinkaApiError } from './api-status';

/**
 * A 401 from any session door means the token is dead (link revoked, key
 * rotated). The session module registers the handler that forgets the link
 * and ends the recording locally; api.ts only reports.
 */
let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(fn: () => void): () => void {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = null;
  };
}

function reportStatus(status: number): void {
  if (isUnauthorized(status)) unauthorizedHandler?.();
}

/** What the policy read decides for a session (or the idle flight recorder). */
export interface RecorderPolicy {
  /** null = the engine's safe defaults. */
  policy: RedactionPolicy | null;
  /**
   * The sheets take images: the server answered `attachments: true`. Absent
   * (a server before attachments) and `false` (switched off) both read false.
   */
  attachments: boolean;
}

/**
 * Fetch the workspace redaction policy at session start. NEVER rejects: a
 * null policy (server too old, network down, 4xx) means the engine's safe
 * defaults — fail closed, never capture-everything — and no attachments.
 */
export async function fetchPolicy(): Promise<RecorderPolicy> {
  try {
    const res = await api<{ policy?: RedactionPolicy | null; attachments?: unknown }>('GET', '/api/v1/recorder/policy');
    return { policy: res.policy ?? null, attachments: res.attachments === true };
  } catch (e) {
    console.warn('vitrinka: redaction policy fetch failed — using safe defaults', e);
    return { policy: null, attachments: false };
  }
}

export interface ApiOptions {
  /**
   * Survive page unload (the pagehide flush). Browsers cap keepalive bodies at
   * 64 KiB — callers pass it only for a small tail batch.
   */
  keepalive?: boolean;
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  opts: ApiOptions = {},
): Promise<T> {
  const { url } = recorderConfig();
  const key = bearerToken();
  const res = await fetch(url + path, {
    method,
    mode: 'cors',
    credentials: 'omit',
    keepalive: opts.keepalive ?? false,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    reportStatus(res.status);
    throw new VitrinkaApiError(`${method} ${path} → ${res.status}: ${text}`, res.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Upload one rrweb chunk (an already-serialized JSON array of rrweb events)
 * under a pre-allocated seq. Returns the server's blobKey — the matching
 * `rrweb` event row carries it.
 */
export function uploadChunk(sessionId: string, seq: number, body: string): Promise<{ blobKey?: string }> {
  return upload(sessionId, 'chunk', seq, 'application/json', body);
}

/**
 * Upload one attached image (png, webp or jpeg; ≤ 12 MiB) under its
 * `attachment` event's pre-allocated seq through the screenshot leaf, with
 * the blob's own Content-Type. Returns the server's blobKey — the event
 * carries it, exactly like a `shot`.
 */
export function uploadImage(sessionId: string, seq: number, blob: Blob): Promise<{ blobKey?: string }> {
  return upload(sessionId, 'shot', seq, blob.type, blob);
}

async function upload(
  sessionId: string,
  leaf: 'chunk' | 'shot',
  seq: number,
  contentType: string,
  body: string | Blob,
): Promise<{ blobKey?: string }> {
  const { url } = recorderConfig();
  const key = bearerToken();
  const res = await fetch(`${url}/api/v1/sessions/${sessionId}/${leaf}?seq=${seq}`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { authorization: `Bearer ${key}`, 'content-type': contentType },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    reportStatus(res.status);
    throw new VitrinkaApiError(`POST ${leaf} seq ${seq} → ${res.status}: ${text}`, res.status);
  }
  try {
    return JSON.parse(text) as { blobKey?: string };
  } catch {
    return {};
  }
}
