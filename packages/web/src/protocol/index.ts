/**
 * MIRROR of `packages/expo/src/protocol/index.ts` — platform-first packages
 * each own their copy, and this one MUST stay byte-compatible with expo's
 * (same shapes, same field names): the vitrinka server pins ONE ingest
 * contract and both recorders ride it. Edit expo's first, then re-mirror.
 */
/**
 * The recorder↔server wire contract — `@vitrinka/web/protocol` (mirrors `@vitrinka/expo/protocol`).
 *
 * Everything the recorders send rides these shapes over four routes:
 *
 *   POST  /api/v1/sessions            SessionCreateRequest → SessionCreateResponse
 *   POST  /api/v1/sessions/:id/events { events: RecorderEvent[] }
 *   POST  /api/v1/sessions/:id/shot?seq=N   (image body; the event stream
 *                                            carries a matching 'shot' event)
 *   PATCH /api/v1/sessions/:id        { status: SessionStatus }
 *
 * This module is types-only and dependency-free on purpose: the vitrinka
 * server pins its ingest contract against it, so a change here is a change to
 * the wire — version it deliberately.
 */

/** One captured event in a session's ordered stream. */
export interface RecorderEvent {
  /** Recorder-allocated, strictly increasing; the delivery-ack unit. */
  seq: number;
  /** ISO timestamp at capture. */
  ts: string;
  /** Timeline lane (tab/section grouping). */
  tabId: string;
  /** Full pathname/host context the event happened on. */
  tabHost: string;
  /** Event kind: 'nav' | 'click' | 'shot' | 'note' | 'net' | 'console' | … */
  kind: string;
  payload?: Record<string, unknown>;
  /** Server blob reference for 'shot' events (set after upload). */
  blobKey?: string;
}

export interface SessionCreateRequest {
  /** App id the server resolves project+environment from. */
  app: string;
  title: string;
  /** Explicit server lane; omitted = the server's app-id rule decides. */
  environment?: string;
  meta?: {
    /** Recorder implementation + protocol revision, e.g. 'vitrinka-expo/1'. */
    recorder?: string;
    platform?: string;
    appVersion?: string;
    /** 'ai' marks a machine-driven run. */
    driver?: string;
    [key: string]: unknown;
  };
}

export interface SessionCreateResponse {
  id: string;
  project: string;
  environment: string;
  title: string;
}

export type SessionStatus = 'recording' | 'paused' | 'done';

/** GET /api/v1/sessions/:id — the reconcile poll's answer. */
export interface SessionReconcileResponse {
  /** Highest seq the server actually holds. */
  maxSeq?: number;
  status?: string;
  deletedAt?: string | null;
}

/** PATCH response when a session completes (board projection). */
export interface SessionDone {
  boardSlug?: string;
  board?: { url?: string };
}
