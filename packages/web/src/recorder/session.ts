/**
 * Session lifecycle + shared recorder state, ported from the Expo recorder
 * (itself from the extension's start/pause/stop semantics):
 *
 * - start: POST /sessions {host, title, meta} — the recorder key pins the
 *   project; the server resolves the environment (or honours an explicit one).
 * - stop: drain FIRST; a timed-out drain REFUSES the stop (capture freezes
 *   paused, durable tail kept, "stop again once online"). A permanent PATCH
 *   verdict completes the stop locally so the tester isn't wedged.
 * - pause: freezes the HUD clock via activeMs/resumeAt bookkeeping.
 * - reconcile (extension D5/D9): armed for the life of the session; a dead
 *   verdict freezes capture, and Stop on a dead session completes locally.
 */
import type { RedactionPolicy } from '@vitrinka/redact';

import type { SessionDone } from '../protocol';
import { api, fetchPolicy, permanentStatus, VitrinkaApiError } from './api';
import { setRedactionPolicy } from './capture/redact';
import { recorderConfig } from './config';
import {
  armReconcile,
  capturesSettled,
  disarmReconcile,
  drainBuffer,
  getState,
  pushEvent,
  queuedCount,
  resetHealth,
  resetIdle,
  resetQueues,
  type SessionState,
  setState,
} from './queue';
import { currentRoute, notify } from './state';

export { currentRoute, notify, subscribe } from './state';
export type { SessionDone } from '../protocol';

/** Sent as `meta.recorder`; bumped with the package version. */
export const RECORDER_VERSION = '0.1.2';
export const RECORDER_ID = `web/${RECORDER_VERSION}`;

/** What `POST /api/v1/sessions` answers (the fields this recorder keeps). */
export interface SessionOut {
  id: string;
  project: string;
  environment: string;
  title: string;
  boardUrl?: string;
  boardSlug?: string;
  workspace?: string;
}

/**
 * Re-apply a RECOVERED session's redaction policy after a reload — and
 * re-FETCH it when the original fetch never settled (`policy === undefined`).
 */
let policyRecoveryInFlight = false;

export function recoverRedactionPolicy(): void {
  const rec = getState();
  if (!rec) return;
  setRedactionPolicy(rec.policy ?? null);
  if (rec.policy !== undefined) return;
  if (policyRecoveryInFlight) return;
  policyRecoveryInFlight = true;
  void fetchPolicy()
    .then((policy) => {
      const live = getState();
      if (live?.sessionId !== rec.sessionId) return;
      if (live.policy !== undefined) return;
      setRedactionPolicy(policy);
      setState({ ...live, policy });
    })
    .finally(() => {
      policyRecoveryInFlight = false;
    });
}

export function elapsedOf(rec: SessionState | null): number {
  if (!rec) return 0;
  let ms = rec.activeMs || 0;
  if (!rec.paused && rec.resumeAt) ms += Date.now() - Date.parse(rec.resumeAt);
  return ms;
}

// -- lifecycle ---------------------------------------------------------------

export interface StartOptions {
  title?: string;
  /** Server lane; omitted = the project's rule decides (config's default applies). */
  environment?: string;
  /** Marks a machine-driven run (recorded in session meta). */
  driver?: 'ai';
  /** Tags to attach right after create (non-fatal). */
  tags?: string[];
}

/** The document's host — the create's `host`, the same field the extension sends. */
function pageHost(): string {
  try {
    return globalThis.location?.host ?? '';
  } catch {
    return '';
  }
}

export async function startSession(opts: StartOptions = {}): Promise<SessionState> {
  const cfg = recorderConfig();
  // The safe defaults apply from the first captured byte; the workspace
  // policy (fetched in parallel — fetchPolicy never rejects) can only ADD
  // rules or, self-host only, fullFidelity.
  setRedactionPolicy(null);
  const policyPromise = fetchPolicy();
  const environment = opts.environment ?? cfg.environment;
  const ses = await api<SessionOut>('POST', '/api/v1/sessions', {
    host: pageHost(),
    title: opts.title || '',
    ...(environment ? { environment } : {}),
    meta: {
      recorder: RECORDER_ID,
      userAgent: globalThis.navigator?.userAgent ?? '',
      platform: 'web',
      ...(cfg.appVersion ? { appVersion: cfg.appVersion } : {}),
      ...(opts.driver ? { driver: opts.driver } : {}),
    },
  });
  void policyPromise.then((policy) => {
    const rec = getState();
    if (rec?.sessionId !== ses.id) return;
    setRedactionPolicy(policy);
    setState({ ...rec, policy });
  });
  setState({
    sessionId: ses.id,
    project: ses.project,
    environment: ses.environment,
    title: ses.title,
    ...(ses.boardUrl ? { boardUrl: ses.boardUrl } : {}),
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
  });
  resetQueues();
  resetHealth();
  resetIdle();
  await attachTags(ses.id, opts.tags);
  armReconcile();
  pushEvent(
    'nav',
    { url: currentUrl(), route: currentRoute.pathname },
    { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost },
  );
  notify();
  return getState() as SessionState;
}

function currentUrl(): string {
  try {
    return globalThis.location?.href ?? currentRoute.pathname;
  } catch {
    return currentRoute.pathname;
  }
}

async function attachTags(sessionId: string, tags: string[] | undefined): Promise<void> {
  if (!tags?.length) return;
  try {
    await api('POST', `/api/v1/sessions/${sessionId}/tags`, { tags });
  } catch (e) {
    console.warn(`vitrinka: could not tag session ${sessionId} with ${tags.join(', ')}`, e);
  }
}

export async function togglePause(): Promise<boolean> {
  const rec = getState();
  if (!rec || rec.dead) return false;
  rec.paused = !rec.paused;
  if (rec.paused) {
    rec.activeMs = (rec.activeMs || 0) + (rec.resumeAt ? Date.now() - Date.parse(rec.resumeAt) : 0);
    rec.resumeAt = null;
  } else {
    rec.resumeAt = new Date().toISOString();
  }
  setState(rec);
  notify();
  await api('PATCH', `/api/v1/sessions/${rec.sessionId}`, {
    status: rec.paused ? 'paused' : 'recording',
  }).catch((e) => console.warn('vitrinka: pause PATCH failed', e));
  return rec.paused;
}

const route = () => ({ tabId: currentRoute.tabId, tabHost: currentRoute.tabHost });

/** A plain note — `{text, route}`, the extension's shape. */
export function addNote(text: string): void {
  pushEvent('note', { text, route: currentRoute.pathname }, route());
}

/** A rect in CSS pixels (viewport coordinates). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Scale a viewport rect to device pixels — the extension's `imageRect` space. */
export function imagePixels(r: ViewRect): ViewRect {
  const s = globalThis.devicePixelRatio || 1;
  return {
    x: Math.round(r.x * s),
    y: Math.round(r.y * s),
    w: Math.round(r.w * s),
    h: Math.round(r.h * s),
  };
}

/**
 * An annotation — the extension's annotate-note `{text, rect, selector,
 * annotate: true}` (+ `task` when the tester chose the task destination);
 * vitrinka projects it into a board annotation. `selector` is '' for a free
 * region. The rect is in device pixels. An empty note is still a valid
 * annotation, matching the extension.
 */
export function addAnnotation(
  text: string,
  rect: ViewRect,
  selector: string,
  opts: { task?: boolean } = {},
): void {
  pushEvent(
    'note',
    {
      text,
      rect: imagePixels(rect),
      selector,
      annotate: true,
      route: currentRoute.pathname,
      ...(opts.task ? { task: true } : {}),
    },
    route(),
  );
}

/**
 * Hooks that run at the top of Stop, before the drain snapshot — the rrweb
 * lane ships its sub-2s tail here so the last DOM events make the session.
 */
const beforeStopHooks = new Set<() => void>();

export function onBeforeStop(fn: () => void): () => void {
  beforeStopHooks.add(fn);
  return () => beforeStopHooks.delete(fn);
}

/**
 * Stop the session. Throws with the queued-item count when the server is
 * unreachable — the durable tail is NEVER deleted; capture freezes paused and
 * a later Stop finishes the job once online.
 */
export async function stopSession(): Promise<SessionDone | null> {
  const rec = getState();
  if (!rec) return null;
  disarmReconcile();
  for (const fn of beforeStopHooks) {
    try {
      fn();
    } catch (e) {
      console.warn('vitrinka: before-stop hook failed', e);
    }
  }
  const completeDeadStop = (reason: string | undefined): never => {
    const kept = queuedCount();
    setState(null);
    setRedactionPolicy(null);
    resetQueues();
    notify();
    throw new Error(
      `${reason || 'session rejected by the server'} — recording ended locally` +
        (kept ? `; ${kept} undelivered item(s) discarded` : ''),
    );
  };
  if (rec.dead) completeDeadStop(rec.deadReason);
  if (!(await capturesSettled())) {
    console.warn('vitrinka: stopping with unsettled captures — a late event may not make this session');
  }
  if (!(await drainBuffer())) {
    const held = getState();
    if (held?.dead) completeDeadStop(held.deadReason);
    if (held && !held.paused) {
      held.activeMs = elapsedOf(held);
      held.paused = true;
      held.resumeAt = null;
      setState(held);
    }
    armReconcile();
    notify();
    throw new Error(`server unreachable — ${queuedCount()} item(s) kept; stop again once online`);
  }
  let done: SessionDone | null = null;
  try {
    done = await api<SessionDone>('PATCH', `/api/v1/sessions/${rec.sessionId}`, { status: 'done' });
  } catch (e) {
    if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
      console.warn('vitrinka: stop rejected permanently — clearing local session', e);
    } else {
      console.warn('vitrinka: stop PATCH failed — session kept', e);
      armReconcile();
      throw e;
    }
  }
  setState(null);
  setRedactionPolicy(null);
  resetQueues();
  notify();
  return done;
}

export type { RedactionPolicy };
