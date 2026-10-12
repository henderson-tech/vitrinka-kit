/**
 * Programmatic control handle — `window.__vitrinkaRecorder`. The web sibling
 * of the Expo recorder's devtools channel: an agent driving the page with
 * Playwright can start a journey, drop notes and stop it without touching
 * the HUD, and read a status snapshot back.
 *
 * ONE recorder: while the browser extension (or another recorder on the
 * page) leads, `status()` names it (`leader`, `following`), `pause`, `stop`
 * and `note` act on it, and `start` rejects with a `RecorderBusyError`
 * (`code: 'recorder_busy'`).
 */
import { type Leader, leadStatus, sendToLeader } from './lead';
import { getState, health } from './queue';
import { boardUrlOf } from './recents';
import { addNote, elapsedOf, startSession, type StartOptions, stopSession, togglePause } from './session';

export interface RecorderStatus {
  /** A recording captures this document — this recorder's, or the leader's it follows. */
  recording: boolean;
  /** Who records: this page's recorder, or the one it follows. Absent = nobody. */
  leader?: Leader;
  /** Set while another recorder leads; pause, stop and note then act on it. */
  following?: Leader;
  sessionId?: string;
  project?: string;
  environment?: string;
  title?: string;
  boardUrl?: string;
  paused?: boolean;
  dead?: boolean;
  deadReason?: string;
  elapsedMs?: number;
  events?: number;
  queued?: number;
  synced?: boolean;
  healthState?: string;
}

export interface RecorderControl {
  start(opts?: StartOptions): Promise<RecorderStatus>;
  pause(): Promise<boolean>;
  stop(): Promise<{ boardUrl?: string } & RecorderStatus>;
  note(text: string): void;
  status(): RecorderStatus;
}

export function snapshot(): RecorderStatus {
  const lead = leadStatus();
  if (lead.following) {
    // The leader's claim on this document (none when it records another tab).
    const c = lead.claim && lead.claim.by === lead.following ? lead.claim : null;
    const live = c !== null && c.state !== 'saved';
    return {
      recording: live,
      leader: lead.following,
      following: lead.following,
      ...(live && c.sessionId ? { sessionId: c.sessionId } : {}),
      ...(live ? { paused: c.state === 'paused' } : {}),
    };
  }
  const rec = getState();
  if (!rec) return { recording: false };
  const h = health();
  return {
    recording: true,
    leader: 'page',
    sessionId: rec.sessionId,
    project: rec.project,
    environment: rec.environment,
    title: rec.title,
    boardUrl: rec.boardUrl,
    paused: rec.paused,
    dead: Boolean(rec.dead),
    deadReason: rec.deadReason ?? '',
    elapsedMs: elapsedOf(rec),
    events: rec.seq,
    queued: h.queued,
    synced: h.synced,
    healthState: h.state,
  };
}

export const CONTROL_KEY = '__vitrinkaRecorder';

export function installControl(): () => void {
  const control: RecorderControl = {
    async start(opts = {}) {
      // Idempotent: a second start must not orphan the first recording.
      if (getState() && !leadStatus().following) throw new Error('vitrinka: a session is already recording');
      // Another recorder leading refuses here, before any network call (RecorderBusyError).
      await startSession(opts);
      return snapshot();
    },
    async pause() {
      if (!leadStatus().following) return togglePause();
      const was = snapshot().paused === true;
      sendToLeader('pause');
      return !was;
    },
    async stop() {
      if (leadStatus().following) {
        const captured = snapshot();
        sendToLeader('stop');
        return captured;
      }
      const captured = snapshot();
      const done = await stopSession();
      return { ...captured, boardUrl: boardUrlOf(done) ?? captured.boardUrl };
    },
    note(text) {
      const t = text.trim();
      if (leadStatus().following) {
        if (!t) throw new Error('vitrinka: note text is empty');
        return sendToLeader('note', t);
      }
      if (!getState()) throw new Error('vitrinka: no session is recording');
      if (!t) throw new Error('vitrinka: note text is empty');
      addNote(t);
    },
    status: snapshot,
  };
  const g = globalThis as typeof globalThis & { [CONTROL_KEY]?: RecorderControl };
  g[CONTROL_KEY] = control;
  return () => {
    if (g[CONTROL_KEY] === control) delete g[CONTROL_KEY];
  };
}
