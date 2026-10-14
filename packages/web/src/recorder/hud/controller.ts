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
  /** The note / annotate / report sheet's width, CSS px; 0 = the HUD's default. */
  sheetW: number;
  /** The cap its text box grows to before it scrolls, CSS px; 0 = the HUD's default (20 rows). */
  sheetH: number;
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
  /** Items (events + rrweb chunks + attached images) not yet delivered. */
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
  /** What the server acknowledged from this tab, by kind (the stats float). Absent = the host does not count. */
  acked?: HudAcked;
  /** Client ids of this tab's notes not yet acknowledged; the "Saved" flash waits for its note to leave. */
  pendingNotes?: readonly string[];
}

/** Acknowledged deliveries, as a tester names them. */
export interface HudAcked {
  /** Clicks. */
  actions: number;
  /** Navigations. */
  pages: number;
  /** DOM frames (rrweb events). */
  frames: number;
  /** Notes and annotations. */
  notes: number;
}

/** The server's board build of a saved session (`GET /api/v1/sessions/{id}` → `projection`). */
export interface HudProjection {
  state: 'idle' | 'queued' | 'running' | 'ready' | 'empty' | 'failed';
  /** What the running pass is doing, in the server's words. */
  step?: string;
  done?: number;
  total?: number;
  error?: string;
  /** A failed build another `POST …/project` may fix. */
  retryable?: boolean;
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
  /** The board build while the HUD waits for it; absent once the link is known or nobody polls. */
  projection?: HudProjection;
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
  /**
   * The sheets take images (paperclip, paste, drop) — the server answered
   * `attachments: true` to the policy read. Absent or false = text only.
   */
  canAttach?: boolean;
  /**
   * ONE recorder: another recorder leads this browser's recording — the
   * extension, or the page's own recorder — and this HUD is its remote. The
   * HUD hides, closes its sheet, menu, link sheet and annotate mode (the
   * drafts and their images survive, as a cancel keeps them; the dock spot
   * stays) and binds no shortcut. Absent = this HUD's host leads or is idle.
   */
  following?: 'page' | 'extension';
}

/** The pill's inline flow face (`hud/flow.ts`), as `faceChanged` reports it. */
export type HudFace = 'none' | 'confirm' | 'saving' | 'saved' | 'failed';

/** One image a tester attached, already normalized by the HUD:
 *  re-encoded (EXIF/GPS gone), long edge ≤ 2560 px, ≤ 12 MiB. */
export interface HudAttachment {
  /** The original file name ("pasted image.png" for a paste). */
  name: string;
  /** image/webp, image/jpeg or image/png — what /shot accepts. */
  blob: Blob;
  /** Pixel size after normalizing. */
  w: number;
  h: number;
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

/**
 * A note's identity (D6/D7): the HUD mints `cid`; `replaces` supersedes the
 * named note (an edit), `refs` points at others. Client ids, never seqs.
 */
export interface HudNoteLink {
  cid: string;
  replaces?: string;
  refs?: readonly string[];
}

export interface HudAnnotation {
  text: string;
  rect: HudRect;
  /** '' for a free region. */
  selector: string;
  attachments?: readonly HudAttachment[];
  link?: HudNoteLink;
}

/** One note of the live recording, as `listNotes` keeps it. */
export interface HudNote {
  cid: string;
  text: string;
  /** Epoch ms of capture. */
  at: number;
  route: string;
  /** A region / element annotation, or a plain note. */
  region: boolean;
  /** CSS-pixel size of the region, when it is one. */
  w?: number;
  h?: number;
  replaces?: string;
  refs?: readonly string[];
}

/** What "Report a bug" sends from the sheet. */
export interface HudReport {
  /** The description (required); its first line titles the report. */
  text: string;
  /** The region marked on screen, CSS px; null = the whole viewport. */
  rect: HudRect | null;
  /** The marked element's selector; '' for a region or no mark. */
  selector: string;
  attachments?: readonly HudAttachment[];
}

/**
 * What a stop or an idle report saved. `boardUrl` when the board already
 * exists; else `sessionId` names the recent whose link the Saved face takes
 * once the server has built the board.
 */
export interface HudSaved {
  boardUrl?: string;
  sessionId?: string;
}

export interface HudController {
  getSnapshot(): HudSnapshot;
  subscribe(listener: () => void): () => void;
  start(opts: { title: string }): Promise<void>;
  togglePause(): Promise<void>;
  /** Drains, then closes the session; rejects (session kept) while unreachable. */
  stop(): Promise<HudSaved>;
  /** `attachments` only when `canAttach`; with them, `text` may be empty. */
  note(text: string, attachments?: readonly HudAttachment[], link?: HudNoteLink): void;
  annotate(a: HudAnnotation): void;
  /**
   * The live recording's notes, every tab's, oldest first — what the notes
   * sheet lists (a recorder token reads nothing back from the server, so the
   * host keeps them on the device for the recording's life). Optional; never
   * rejects (null = no live recording).
   */
  listNotes?(): Promise<HudNote[] | null>;
  /**
   * The picked region's pixels, for the composer's thumbnail (D15): a data
   * URL, or null where the host cannot read pixels (the page recorder never
   * can — it simply omits this). Never rejects.
   */
  captureRegion?(rect: HudRect): Promise<string | null>;
  /** Ask the server to build a saved session's board again (a retryable failure). Rejects with the reason. */
  retryBuild?(sessionId: string): Promise<void>;
  setAnnotating(active: boolean): void;
  link(): Promise<HudLinkFlow>;
  unlink(): void;
  /** Refresh `account` (and server prefs); null when unknown. Never rejects. */
  getMe(): Promise<HudAccount | null>;
  /**
   * Apply locally at once, then persist where the server keeps prefs. Never
   * rejects. The sheet size (`sheetW`/`sheetH`, one call per resize) goes in
   * its own PATCH: a server that predates it answers 422, and the size then
   * stays on the device without costing size/verbose their server copy.
   */
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
  report?(r: HudReport): Promise<HudSaved>;
  /**
   * ONE recorder D11: the HUD registers its own Stop flow; the controller
   * runs it when the other side stops the recording remotely (its open sheet
   * closes keeping the draft, annotate exits, Saving → Saved on this pill,
   * no second confirm). Returns the unregister. A host whose HUD is not
   * mounted stops directly. Optional.
   */
  onRemoteStop?(run: () => void): () => void;
  /**
   * ONE recorder D7: the HUD reports its inline flow face, so the controller
   * holds its claim as `saved` while Saving / Saved / failed shows after a
   * stop. Optional.
   */
  faceChanged?(face: HudFace): void;
}

export const DEFAULT_PREFS: HudPrefs = { size: 'md', verbose: false, sheetW: 0, sheetH: 0 };
