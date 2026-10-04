/**
 * The HUD's seam: everything the pill shows comes from a `HudController`
 * snapshot, and everything it does goes through the controller's actions. The
 * in-page recorder supplies one (`recorder/page-controller.ts`); the browser
 * extension can mount the same HUD with its own (`@vitrinka/web/hud`,
 * `build/hud.iife.js`). DOM-free and React-free: only plain data crosses.
 *
 * Contract:
 * - `getSnapshot()` returns the SAME object until something changed
 *   (`useSyncExternalStore` semantics); `subscribe` calls back after a change.
 *   Time-varying values ride as timestamps, so the HUD's own clock tick never
 *   needs a new snapshot.
 * - Actions reject with an `Error` the HUD shows verbatim (`stop` while the
 *   server is unreachable, a failed start). A link flow's `linked` rejects
 *   with an error NAMED `LinkExpired` or `AbortError` for those two outcomes.
 */

export type HudSize = 'sm' | 'md' | 'lg';

export interface HudPrefs {
  size: HudSize;
  /** Technical details (events, queue, last sync, session id, version). */
  verbose: boolean;
}

/** Who the recorder token belongs to (`GET /api/v1/recorder/me`). */
export interface HudAccount {
  /** `linked` = a device link (a user); `key` = an admin-minted recorder key. */
  kind: 'linked' | 'key';
  workspace: { slug: string; name: string };
  user: { email: string; name: string } | null;
  project: string | null;
  label: string | null;
}

export type HudSyncState = 'ok' | 'backlog' | 'offline' | 'dead';

/** Delivery health of the live session — honest: `synced` is the server's word. */
export interface HudSync {
  state: HudSyncState;
  synced: boolean;
  /** Items (events + rrweb chunks) not yet delivered. */
  queued: number;
  /** Of those, rrweb chunks. */
  chunks: number;
  failures: number;
  error: string;
  /** Epoch ms of the last confirmed delivery or reconcile; null before any. */
  lastSyncAt: number | null;
  /** Events allocated so far (the local seq). */
  events: number;
  serverMaxSeq: number;
  deadReason: string;
}

export interface HudRecording {
  sessionId: string;
  title: string;
  /** Server-minted board link; opened verbatim. */
  boardUrl?: string;
  paused: boolean;
  /** The server stopped accepting this session; Stop completes locally. */
  dead: boolean;
  /** Elapsed = activeMs + (now - resumedAt) while running. */
  activeMs: number;
  /** Epoch ms the clock last resumed; null while paused or dead. */
  resumedAt: number | null;
  sync: HudSync;
}

export type HudRecentStatus = 'recording' | 'saved' | 'unsaved' | 'deleted';

/** One of the device's last recordings. */
export interface HudRecent {
  sessionId: string;
  title: string;
  startedAt: number;
  durationMs?: number;
  status: HudRecentStatus;
  boardUrl?: string;
}

export interface HudSnapshot {
  /** Something to authenticate with (an explicit key or a stored link). */
  linked: boolean;
  /** A stored link can be forgotten; an explicit key cannot. */
  canUnlink: boolean;
  /** Annotate mode owns the page pointer (the click lane ignores it). */
  annotating: boolean;
  recording: HudRecording | null;
  /** Null until `getMe` answered (or when the server is too old for it). */
  account: HudAccount | null;
  prefs: HudPrefs;
  /** Newest first, at most five. */
  recents: readonly HudRecent[];
  /** "Go to vitrinka": the configured workspace URL. */
  workspaceUrl: string;
  /** Recorder id, e.g. `web/0.2.1` (verbose mode shows it). */
  version: string;
  /**
   * "Report a bug" can file now (the ⋯ menu shows the row): into the live
   * session, or, idle, with the last minute the host keeps. Absent = never.
   */
  canReport?: boolean;
}

/** The code half of a device link, as the link sheet paints it. */
export interface HudLinkCode {
  user_code: string;
  verifyUrl: string;
  qrUrl: string;
}

export interface HudLinkFlow {
  start: HudLinkCode;
  /** Resolves once approved (the token is stored by then). */
  linked: Promise<void>;
  cancel: () => void;
}

/** A viewport rect in CSS pixels. */
export interface HudRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudAnnotation {
  text: string;
  rect: HudRect;
  /** '' for a free region. */
  selector: string;
  /** Also file it as an intake task. */
  task: boolean;
}

/** What "Report a bug" sends from the sheet. */
export interface HudReport {
  /** The description (required); its first line titles the report. */
  text: string;
  /** The region marked on screen, CSS px; null = the whole viewport. */
  rect: HudRect | null;
  /** The marked element's selector; '' for a region or no mark. */
  selector: string;
}

export interface HudController {
  getSnapshot(): HudSnapshot;
  subscribe(listener: () => void): () => void;
  start(opts: { title: string }): Promise<void>;
  togglePause(): Promise<void>;
  /** Drains, then closes the session; rejects (session kept) while unreachable. */
  stop(): Promise<{ boardUrl?: string }>;
  note(text: string): void;
  annotate(a: HudAnnotation): void;
  setAnnotating(active: boolean): void;
  link(): Promise<HudLinkFlow>;
  unlink(): void;
  /** Refresh `account` (and server prefs); null when unknown. Never rejects. */
  getMe(): Promise<HudAccount | null>;
  /** Apply locally at once, then persist where the server keeps prefs. Never rejects. */
  setPrefs(patch: Partial<HudPrefs>): Promise<void>;
  /** Fill missing board links of recents from the server. Never rejects. */
  refreshRecents(): Promise<void>;
  /**
   * The report sheet opened (`true`: idle, freeze the last minute it will
   * send) or was dismissed (`false`: drop it). Optional, with `report`.
   */
  holdReport?(on: boolean): void;
  /**
   * File a bug report. Recording: a task annotation in the live session
   * (resolves at once). Idle: the held last minute as its own short session
   * — resolves `{boardUrl?}` once it is done, rejects with the reason; a
   * second call after a rejection retries the same report. Optional: a host
   * without it never offers the menu row.
   */
  report?(r: HudReport): Promise<{ boardUrl?: string }>;
}

export const DEFAULT_PREFS: HudPrefs = { size: 'md', verbose: false };
