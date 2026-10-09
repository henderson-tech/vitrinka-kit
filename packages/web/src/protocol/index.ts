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
 *   POST  /api/v1/sessions/:id/shot?seq=N   (image body, its own Content-Type;
 *                                            the event stream carries a
 *                                            matching 'shot' or 'attachment'
 *                                            event under the same seq)
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
  /** Event kind: 'nav' | 'click' | 'shot' | 'note' | 'attachment' | 'net' | 'console' | … */
  kind: string;
  payload?: Record<string, unknown>;
  /**
   * Server blob reference for 'shot' and 'attachment' events: the `blobKey`
   * the `/shot?seq=N` upload of this event's bytes answered (set after upload).
   */
  blobKey?: string;
}

/** The image types `/shot` accepts. */
export type ImageMime = 'image/png' | 'image/webp' | 'image/jpeg';

/**
 * Payload of an 'attachment' event — one image a tester attached to a note.
 * Its bytes are uploaded FIRST through `/shot?seq=<this event's seq>` (≤ 12
 * MiB, the blob's own Content-Type) and the answer's `blobKey` rides the
 * event, exactly like a 'shot'. Same `tabId`/`tabHost` as its note.
 */
export interface AttachmentPayload {
  /** The original file name ("pasted image.png" for a paste). */
  name: string;
  mime: ImageMime;
  /** The uploaded size in bytes. */
  bytes: number;
  /** Pixel size. */
  w?: number;
  h?: number;
}

/**
 * Payload of a 'note' event. An annotation adds `rect`/`selector`/`annotate`
 * (+ `task`); a note with `attachments` may have empty `text` (an image can
 * BE the note), a bug report still needs its description.
 */
export interface NotePayload {
  text: string;
  route?: string;
  /**
   * The seqs of the 'attachment' events this note carries, allocated BEFORE
   * the note's (strictly lower) so a stream replays in order. The server
   * takes at most 10 per note, tolerates one that arrives after its note and
   * one that never arrives (the note lands without it).
   */
  attachments?: number[];
  [key: string]: unknown;
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

/** GET /api/v1/recorder/policy — read at session start. */
export interface RecorderPolicyResponse {
  /** The workspace redaction policy (`@vitrinka/redact`); null = the engine's defaults. */
  policy?: Record<string, unknown> | null;
  fullFidelityAllowed?: boolean;
  /**
   * Recorders offer image attachments only on `true`: absent on a server
   * before them, `false` when the workspace switched them off.
   */
  attachments?: boolean;
}

/**
 * PATCH response when a session completes. The board is projected AFTER the
 * stop, so `boardUrl` is usually absent here: `projection` says how far it
 * got, and the session read names the board once it exists.
 */
export interface SessionDone {
  boardSlug?: string;
  /** The board's address, minted by the server; only once the board exists. */
  boardUrl?: string;
  /** An older server's spelling of `boardUrl`. */
  board?: { url?: string };
  projection?: { state?: string };
}
