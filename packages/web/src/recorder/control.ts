/**
 * Programmatic control handle — `window.__vitrinkaRecorder`. The web sibling
 * of the Expo recorder's devtools channel: an agent driving the page with
 * Playwright can start a journey, drop notes and stop it without touching
 * the HUD, and read a status snapshot back.
 */
import { getState, health } from './queue';
import { addNote, elapsedOf, startSession, type StartOptions, stopSession, togglePause } from './session';

export interface RecorderStatus {
  recording: boolean;
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
  const rec = getState();
  if (!rec) return { recording: false };
  const h = health();
  return {
    recording: true,
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
      if (getState()) throw new Error('vitrinka: a session is already recording');
      await startSession(opts);
      return snapshot();
    },
    pause: () => togglePause(),
    async stop() {
      const captured = snapshot();
      const done = await stopSession();
      return { ...captured, boardUrl: done?.board?.url ?? captured.boardUrl };
    },
    note(text) {
      const t = text.trim();
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
