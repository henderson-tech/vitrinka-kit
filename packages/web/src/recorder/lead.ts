/**
 * The page side of ONE recorder (extension + page recorder decisions,
 * 2026-10-12): this document's recorder either LEADS — holds the claim on
 * `<html>` — or FOLLOWS the recorder that does: the browser extension, or
 * another recorder bundle on the page. The protocol itself is `one.ts`.
 *
 * Started by the recorder root (`startLead`, RecorderProvider). While it runs:
 * - `data-vitrinka-page` marks the document, written before the first ask
 *   (the extension's `one.js` answers only where it stands).
 * - It answers `hello` asks with what it leads; the extension's hellos tell
 *   it the extension records — here (its claim) or in another tab (D6).
 * - Following: `leadState.following` is set, every lane and the flight
 *   recorder go quiet, the HUD hides; a session of its own (resumed after a
 *   reload, joined from another tab) waits, capturing nothing, and resumes
 *   once the leader lets go (D14). The follower pings the holder when the
 *   claim changes, every 10 s, on becoming visible and before any remote
 *   command; a holder that does not answer is cleared under its own id (D5).
 * - Leading: it holds the claim through every transition — starting,
 *   recording, paused, stopping, and `saved` while the HUD's stop face shows
 *   (D7) — and answers the holder's commands synchronously (D11).
 */
import type { HudFace } from './hud/controller';
import {
  announce,
  answeredBy,
  ask,
  type Claim,
  type ClaimState,
  type Command,
  type CommandOp,
  type CommandReply,
  documentEnv,
  type Hello,
  isLive,
  type Live,
  markPage,
  nonce,
  type OneEnv,
  type OneParty,
  type OneSelf,
  readClaim,
  releaseClaim,
  sendCommand,
  serveCommands,
  serveHello,
  takeClaim,
  unmarkPage,
  updateClaim,
  watchClaim,
} from './one';
import { getState, stoppingElsewhere } from './queue';
import { leadState, notify, subscribe } from './state';
import { RECORDER_ID } from './version';

export type Leader = OneParty;

/**
 * A Start refused because another recorder leads (D12). `code` is
 * `recorder_busy`; the message is shown verbatim where Start was pressed.
 */
export class RecorderBusyError extends Error {
  readonly code = 'recorder_busy' as const;
  readonly leader: Leader;
  constructor(message: string, leader: Leader) {
    super(message);
    this.name = 'RecorderBusy';
    this.leader = leader;
  }
}

/** The leader's own doors, which a remote command opens (the root supplies them). */
export interface LeadHandlers {
  pause(): void;
  /** The direct stop, for when no HUD registered its Stop flow. */
  stop(): void;
  note(text: string): void;
  /**
   * Re-read the durable session record before a waiting session resumes
   * (`resyncStoredSession`); false when the cached one ended or was replaced.
   */
  resync?(): boolean;
}

/** How often a follower pings the holder. */
export const PING_MS = 10_000;

const self: OneSelf = { from: 'page', inst: nonce('p') };

let env: OneEnv | null = null;
let users = 0;
let handlers: LeadHandlers | null = null;
let teardown: (() => void) | null = null;
/** Extension parties (by instance) and the recording each says is live. */
const extension = new Map<string, Live>();
let starting = false;
let stopping: string | null = null;
let face: HudFace = 'none';
let remoteStop: (() => void) | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** The claim holder `refresh` last announced. */
let claimBy: Leader | null = null;

// -- what this document knows --------------------------------------------------

function heldClaim(): Claim | null {
  if (!env) return null;
  const c = readClaim(env);
  return c?.id === self.inst ? c : null;
}

function extensionLive(): Live | null {
  for (const l of extension.values()) if (isLive(l.state)) return l;
  return null;
}

/**
 * The extension's recording is under way in another tab. Its Start probe
 * announces `starting` before it reads this page's claim, and a draining
 * Stop is ending: neither takes a document from the page that leads (D1).
 */
function extensionRecordingElsewhere(): boolean {
  for (const l of extension.values()) if (!l.here && (l.state === 'recording' || l.state === 'paused')) return true;
  return false;
}

/** A claim of another holder (any state: a `saved` one keeps its face, D7), else the extension elsewhere. */
function computeFollowing(): Leader | null {
  if (!env) return null;
  const c = readClaim(env);
  if (c) return c.id === self.inst ? null : c.by;
  return extensionLive() ? 'extension' : null;
}

function liveOf(): Live | null {
  const c = heldClaim();
  return c ? { by: 'page', state: c.state, here: true, id: c.id } : null;
}

/** The claim this recorder should hold now; null = none. */
function desired(held: Claim | null): { state: ClaimState; sessionId: string } | null {
  if (starting) return { state: 'starting', sessionId: '' };
  const rec = getState();
  if (rec) {
    const state = stopping === rec.sessionId || stoppingElsewhere(rec) ? 'stopping' : rec.paused ? 'paused' : 'recording';
    // A session web 0.5.0 stored (and this version resumed) still carries the server's numeric id.
    return { state, sessionId: String(rec.sessionId) };
  }
  // The stop's face still shows on this pill: hold the claim as `saved` (D7).
  if (held && (face === 'saving' || face === 'saved' || face === 'failed')) return { state: 'saved', sessionId: held.sessionId };
  return null;
}

/** Write the claim this recorder should hold — never over another holder (D14). */
function syncClaim(): void {
  if (!env) return;
  const cur = readClaim(env);
  const held = cur?.id === self.inst ? cur : null;
  const want = desired(held);
  if (!want) {
    if (held && releaseClaim(env, self.inst)) announce(env, self, null);
    return;
  }
  if (held) {
    // The extension recording elsewhere keeps the browser even over a claim
    // this page holds — a tab thawing after the extension's Start probe
    // could not reach it, or a Start whose probe ran before this claim: let
    // go and wait (D14), never two recordings. Only a recording under way
    // counts — a probe's `starting` meets this claim and is refused (D13).
    // A Stop already draining here keeps its face.
    if (want.state !== 'saved' && want.state !== 'stopping' && extensionRecordingElsewhere()) {
      if (releaseClaim(env, self.inst)) announce(env, self, null);
      return;
    }
    if (held.state !== want.state || held.sessionId !== want.sessionId) {
      updateClaim(env, self.inst, want);
      announce(env, self, liveOf());
    }
    return;
  }
  // A live session of this page's own (a resume, a cross-tab join) claims an
  // unheld document only: another holder keeps it, and an extension
  // recording elsewhere keeps the browser — the session waits (D14).
  if (want.state === 'saved' || cur || extensionLive()) return;
  // Another recorder bundle in THIS document may have ended (or replaced)
  // the session meanwhile, and storage events never reach the document that
  // wrote them: the durable record decides before the cache resumes.
  if (!starting && handlers?.resync && !handlers.resync()) return;
  if (takeClaim(env, self, { id: self.inst, ...want }).ok) announce(env, self, liveOf());
}

function armPing(): void {
  const want = leadState.following !== null;
  if (want && !pingTimer) pingTimer = setInterval(pingLeader, PING_MS);
  else if (!want && pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

/**
 * Re-derive the claim and who leads; announce a change of leader or of the
 * claim's holder to the lanes and the HUD. The HUD's remote face reads the
 * holder (`followingElsewhere`), and the extension's hello can land before
 * its claim: a holder arriving under an unchanged leader announces too.
 */
function refresh(): void {
  if (!env) return;
  syncClaim();
  const next = computeFollowing();
  const by = readClaim(env)?.by ?? null;
  if (next === leadState.following && by === claimBy) return;
  leadState.following = next;
  claimBy = by;
  armPing();
  notify();
}

/** Take the extension parties' word from a complete set of answers. */
function absorbAnswers(answers: readonly Hello[]): void {
  extension.clear();
  for (const h of answers) if (h.from === 'extension' && h.live) extension.set(h.inst, h.live);
}

/**
 * Ping (D5): ask who is here, take the extension's word, clear a holder that
 * no longer answers (under its own id), re-derive. A follower runs it every
 * `PING_MS`, on becoming visible and before a remote command, so a page
 * never waits on an extension that was reloaded or uninstalled.
 */
export function pingLeader(): void {
  if (!env) return;
  const answers = ask(env, self);
  absorbAnswers(answers);
  const cur = readClaim(env);
  if (cur && cur.id !== self.inst && !answeredBy(answers, cur)) releaseClaim(env, cur.id);
  refresh();
}

function onHello(h: Hello): void {
  // Another page bundle speaks through the claim; the extension's word on
  // a recording elsewhere arrives only here.
  if (h.from !== 'extension') return;
  if (h.gone || !h.live) extension.delete(h.inst);
  else extension.set(h.inst, h.live);
  refresh();
}

function onClaimChange(): void {
  if (!env) return;
  const cur = readClaim(env);
  // A new holder must still answer (an orphaned one never will).
  if (cur && cur.id !== self.inst) pingLeader();
  else refresh();
}

/** The holder's side of a remote command (D11): synchronous, inside its dispatch. */
function onCommand(c: Command): CommandReply | null {
  const held = heldClaim();
  if (!held) return null;
  const rec = getState();
  if (!rec || held.state === 'saved') return { ok: false, code: 'not_recording', error: 'the recording has ended' };
  if (held.state === 'starting') return { ok: false, code: 'not_recording', error: 'the recording is still starting' };
  if (held.state === 'stopping') return { ok: false, code: 'stopping', error: `still saving #${rec.sessionId}` };
  try {
    switch (c.op) {
      case 'pause':
        if (rec.dead) return { ok: false, code: 'not_recording', error: 'the server ended this recording' };
        handlers?.pause();
        return { ok: true };
      case 'stop':
        if (remoteStop) remoteStop();
        else handlers?.stop();
        return { ok: true };
      case 'note': {
        const text = c.text?.trim() ?? '';
        if (!text) return { ok: false, code: 'bad_command', error: 'a note needs text' };
        if (rec.dead) return { ok: false, code: 'not_recording', error: 'the server ended this recording' };
        if (rec.paused) return { ok: false, code: 'bad_command', error: 'the recording is paused — resume it to add a note' };
        handlers?.note(text);
        return { ok: true };
      }
    }
  } catch (e) {
    console.warn(`vitrinka: remote ${c.op} failed`, e);
    return { ok: false, code: 'bad_command', error: e instanceof Error ? e.message : String(e) };
  }
}

// -- the root's door -----------------------------------------------------------

/**
 * Join the channel for this document; returns the leave. Idempotent across
 * mounts (the last handlers win). `at` is the document's env unless a test
 * passes its own.
 */
export function startLead(h: LeadHandlers, at: OneEnv | null = documentEnv()): () => void {
  handlers = h;
  if (!at) return () => undefined;
  users++;
  if (!env) {
    env = at;
    const e = at;
    // First: the extension's one.js answers only where this mark stands.
    markPage(e, RECORDER_ID);
    const offHello = serveHello(e, self, liveOf, onHello);
    const offCommands = serveCommands(e, self, onCommand);
    const offWatch = watchClaim(e, onClaimChange);
    const offState = subscribe(refresh);
    const doc = (globalThis as { document?: Document }).document;
    const onVisible = () => {
      if (doc?.visibilityState === 'visible' && leadState.following) pingLeader();
    };
    doc?.addEventListener('visibilitychange', onVisible);
    teardown = () => {
      doc?.removeEventListener('visibilitychange', onVisible);
      offState();
      offWatch();
      offCommands();
      releaseClaim(e, self.inst);
      // Another recorder bundle still mounted here keeps the mark.
      const others = ask(e, self).some((x) => x.from === 'page');
      announce(e, self, null, { gone: true });
      offHello();
      if (!others) unmarkPage(e);
    };
    // The mount's ask: who records, here or elsewhere — then claim a resumed session, or follow.
    pingLeader();
  }
  let left = false;
  return () => {
    if (left) return;
    left = true;
    users--;
    if (users > 0) return;
    teardown?.();
    resetLead();
  };
}

/** The root left: forget the channel. The HUD's registrations (its face, its Stop flow) are the controller's and stay. */
function resetLead(): void {
  teardown = null;
  env = null;
  handlers = null;
  extension.clear();
  starting = false;
  stopping = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  claimBy = null;
  if (leadState.following !== null) {
    leadState.following = null;
    notify();
  }
}

// -- the session's doors -------------------------------------------------------

function busy(leader: Leader, here: boolean, sessionId: string): RecorderBusyError {
  const n = sessionId ? ` (#${sessionId})` : '';
  if (leader === 'page') return new RecorderBusyError(`another recorder on this page is already recording${n} — use its pill, or stop it first`, 'page');
  return here
    ? new RecorderBusyError(`the Vitrinka extension is already recording this page${n} — use its pill, or stop it from the extension`, 'extension')
    : new RecorderBusyError('the Vitrinka extension is recording in another tab — stop it there first', 'extension');
}

/**
 * The Start check-and-set (D4, D12): synchronous, before any network call.
 * Throws a `RecorderBusyError` while another recorder leads — a live claim
 * whose holder answers, or the extension recording in another tab — else
 * claims the document as `starting`. A no-op without a mounted root.
 */
export function claimForStart(): void {
  if (!env) return;
  if (starting) throw new Error('vitrinka: a session is already starting');
  const answers = ask(env, self);
  absorbAnswers(answers);
  const cur = readClaim(env);
  if (cur && cur.id !== self.inst && isLive(cur.state)) {
    if (answeredBy(answers, cur)) {
      refresh();
      throw busy(cur.by, true, cur.sessionId);
    }
    releaseClaim(env, cur.id);
  }
  const ext = extensionLive();
  if (ext) {
    refresh();
    throw busy('extension', ext.here, '');
  }
  // A session of this page's own — live, or waiting while another recorder's
  // Saved face still shows (D14) — is never replaced by a new one.
  if (getState()) throw new Error('vitrinka: a session is already recording');
  const taken = takeClaim(env, self, { id: self.inst, state: 'starting' });
  if (!taken.ok) {
    refresh();
    throw busy(taken.holder.by, true, taken.holder.sessionId);
  }
  starting = true;
  announce(env, self, liveOf());
  refresh();
}

/** The Start settled: created (the claim moves on with the session) or not (it goes). */
export function settleStart(created: boolean): void {
  if (!starting) return;
  starting = false;
  if (!created && env && getState() === null) releaseClaim(env, self.inst);
  refresh();
}

/** A Start claimed this document and waits on its session: no session record yet, but one is on its way. */
export function startInFlight(): boolean {
  return starting;
}

/** This document's Stop is draining `sessionId` (null: it settled). */
export function setLeadStopping(sessionId: string | null): void {
  stopping = sessionId;
  refresh();
}

// -- the controller's doors ----------------------------------------------------

/** The HUD's flow face (D7). */
export function holdFace(f: HudFace): void {
  if (face === f) return;
  face = f;
  refresh();
}

/** The HUD's Stop flow, run by a remote stop (D11); returns the unregister. */
export function setRemoteStop(run: () => void): () => void {
  remoteStop = run;
  return () => {
    if (remoteStop === run) remoteStop = null;
  };
}

/** Who leads now: this recorder (`page`), the one it follows, or nobody. */
export interface LeadStatus {
  leader: Leader | null;
  following: Leader | null;
  /** This document's claim (any holder). */
  claim: Claim | null;
}

export function leadStatus(): LeadStatus {
  const claim = env ? readClaim(env) : null;
  const following = leadState.following;
  const leader = following ?? (claim?.id === self.inst || getState() ? 'page' : null);
  return { leader, following, claim };
}

function refusal(op: CommandOp, code: string | undefined, error: string | undefined, holder: Claim): string {
  if (code === 'not_recording') return op === 'note' ? 'the recording ended before the note arrived' : (error ?? 'the recording has ended');
  if (code === 'stopping') return `still saving${holder.sessionId ? ` #${holder.sessionId}` : ''}`;
  return error ?? 'the recorder refused the command';
}

/**
 * A follower's pause, stop or note, acted on by the leader (D11). Pings the
 * holder first; throws with the reason when it is gone, refused, or the
 * extension leads from another tab (whose endpoint here takes no command).
 */
export function sendToLeader(op: CommandOp, text?: string): void {
  if (!env) throw new Error('vitrinka: no session is recording');
  pingLeader();
  const holder = readClaim(env);
  if (!holder || holder.id === self.inst || !isLive(holder.state)) {
    if (extensionLive()) throw new Error('the Vitrinka extension is recording in another tab — use it there');
    throw new Error(op === 'note' ? 'the recording ended before the note arrived' : 'vitrinka: no session is recording');
  }
  const ack = sendCommand(env, self, op, text);
  if (!ack) {
    // No synchronous answer: the holder is gone (D5).
    releaseClaim(env, holder.id);
    refresh();
    throw new Error('the recorder that held this recording is gone');
  }
  if (!ack.ok) throw new Error(refusal(op, ack.code, ack.error, holder));
}

export function __resetLeadForTests(): void {
  teardown?.();
  users = 0;
  resetLead();
  face = 'none';
  remoteStop = null;
}
