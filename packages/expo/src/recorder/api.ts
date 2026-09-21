/**
 * Vitrinka API client for the journey recorder (dev-only module).
 *
 * Ingest contract, shared with the web recorder and the browser extension:
 *   POST  /api/v1/sessions            {app, title, meta}  → session
 *   POST  /api/v1/sessions/:id/events {events: [...]}
 *   POST  /api/v1/sessions/:id/shot?seq=N   (image body)
 *   PATCH /api/v1/sessions/:id        {status: recording|paused|done}
 *
 * The recorder is ENABLED by `EXPO_PUBLIC_VITRINKA_URL` alone (baked at build
 * time). It AUTHENTICATES with a linked `vkr_` token — the device link the
 * tester completes from the pill (`@vitrinka/link`), stored through the
 * recorder storage driver under `vitrinka.recorder.link` — or, for
 * unattended builds (CI, machine-driven runs), `EXPO_PUBLIC_VITRINKA_TOKEN`
 * holding an admin-minted `vkr_` recorder key — never a workspace token. Both
 * are ingest-only; the env token wins when set. A 401 from any door means
 * the token is dead: the link is forgotten and the recorder returns to its
 * unlinked state.
 */
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { isUnauthorized, type Linked } from '@vitrinka/link';

import { VitrinkaApiError } from './api-status';
import { getRecorderStorage } from './storage';

const BASE = (process.env.EXPO_PUBLIC_VITRINKA_URL ?? '').replace(/\/$/, '');
const ENV_TOKEN = process.env.EXPO_PUBLIC_VITRINKA_TOKEN ?? '';

/** Storage key of the linked token (`@vitrinka/link`). */
export const LINK_KEY = 'vitrinka.recorder.link';

export function vitrinkaBase(): string {
  return BASE;
}

/** Enabled: a URL is baked. Auth is the link or the env token. */
export function vitrinkaConfigured(): boolean {
  return BASE !== '';
}

export function readLink(): Linked | null {
  const raw = getRecorderStorage().getString(LINK_KEY);
  if (!raw) return null;
  try {
    const l = JSON.parse(raw) as Linked;
    return typeof l.token === 'string' && l.token ? l : null;
  } catch {
    return null;
  }
}

export function storeLink(link: Linked): void {
  getRecorderStorage().set(LINK_KEY, JSON.stringify(link));
}

export function clearLink(): void {
  getRecorderStorage().remove(LINK_KEY);
}

/** Something to authenticate with: the env token or a stored link. */
export function vitrinkaLinked(): boolean {
  return ENV_TOKEN !== '' || readLink() !== null;
}

/** The env token is explicit (unattended builds) and wins over a link. */
export function hasEnvToken(): boolean {
  return ENV_TOKEN !== '';
}

function bearer(): string {
  return ENV_TOKEN || readLink()?.token || '';
}

let unauthorizedHandler: (() => void) | null = null;

/** Register the 401 → unlinked transition (installed by the provider). */
export function onUnauthorized(fn: () => void): () => void {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = null;
  };
}

function reportStatus(status: number): void {
  if (isUnauthorized(status)) unauthorizedHandler?.();
}

/** Recorder's own traffic — the network capture layer must skip it. */
export function isVitrinkaUrl(url: string): boolean {
  return BASE !== '' && url.startsWith(BASE);
}

// The status vocabulary lives in a native-import-free module so tests can
// assert against the SHIPPED rule; re-exported here so callers keep one import.
export { permanentStatus, VitrinkaApiError } from './api-status';

/**
 * Fetch the workspace redaction policy at session start. NEVER rejects: null
 * (server too old, network down, 4xx) means the engine's safe defaults — fail
 * closed, never capture-everything. Full fidelity only ever arrives as an
 * explicit server-approved flag inside a successfully fetched policy.
 */
export async function fetchPolicy(): Promise<import('@vitrinka/redact').RedactionPolicy | null> {
  try {
    const res = await api<{ policy?: import('@vitrinka/redact').RedactionPolicy }>(
      'GET',
      '/api/v1/recorder/policy',
    );
    return res.policy ?? null;
  } catch (e) {
    console.warn('vitrinka: redaction policy fetch failed — using safe defaults', e);
    return null;
  }
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      authorization: `Bearer ${bearer()}`,
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

/** Upload a JPEG keyframe from disk. Returns the server's blobKey. */
export async function uploadShot(
  sessionId: string,
  seq: number,
  fileUri: string,
): Promise<{ blobKey?: string }> {
  const res = await uploadAsync(`${BASE}/api/v1/sessions/${sessionId}/shot?seq=${seq}`, fileUri, {
    httpMethod: 'POST',
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    headers: {
      authorization: `Bearer ${bearer()}`,
      'content-type': 'image/jpeg',
    },
  });
  if (res.status < 200 || res.status >= 300) {
    reportStatus(res.status);
    throw new VitrinkaApiError(`POST shot seq ${seq} → ${res.status}: ${res.body}`, res.status);
  }
  try {
    return JSON.parse(res.body) as { blobKey?: string };
  } catch {
    return {};
  }
}
