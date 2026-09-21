/**
 * Vitrinka API client for the web journey recorder.
 *
 * Ingest contract, shared with the Expo recorder and the browser extension:
 *   GET   /api/v1/recorder/policy          workspace redaction policy
 *   POST  /api/v1/sessions                 {host, title, environment?, meta} → session
 *   POST  /api/v1/sessions/:id/events      {events: [...]}
 *   POST  /api/v1/sessions/:id/chunk?seq=N (rrweb batch body, application/json)
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

/**
 * Fetch the workspace redaction policy at session start. NEVER rejects: null
 * (server too old, network down, 4xx) means the engine's safe defaults — fail
 * closed, never capture-everything.
 */
export async function fetchPolicy(): Promise<RedactionPolicy | null> {
  try {
    const res = await api<{ policy?: RedactionPolicy }>('GET', '/api/v1/recorder/policy');
    return res.policy ?? null;
  } catch (e) {
    console.warn('vitrinka: redaction policy fetch failed — using safe defaults', e);
    return null;
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
export async function uploadChunk(
  sessionId: string,
  seq: number,
  body: string,
): Promise<{ blobKey?: string }> {
  const { url } = recorderConfig();
  const key = bearerToken();
  const res = await fetch(`${url}/api/v1/sessions/${sessionId}/chunk?seq=${seq}`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    reportStatus(res.status);
    throw new VitrinkaApiError(`POST chunk seq ${seq} → ${res.status}: ${text}`, res.status);
  }
  try {
    return JSON.parse(text) as { blobKey?: string };
  } catch {
    return {};
  }
}
