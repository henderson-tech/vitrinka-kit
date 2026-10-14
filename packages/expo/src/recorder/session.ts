/**
 * Session lifecycle + shared recorder state, ported from the extension's
 * start/pause/stop semantics:
 *
 * - start: POST /sessions {app} — the server resolves project+environment
 *   from its app-id rule (com.example.app.dev → example/development).
 * - stop: drain FIRST; a timed-out drain REFUSES the stop (capture freezes
 *   paused, durable tail kept on disk, "stop again once online").
 *   A permanent PATCH verdict completes the stop locally so the user isn't
 *   wedged; a transient one keeps the session for retry.
 * - pause: freezes the HUD clock via activeMs/resumeAt bookkeeping.
 * - reconcile (extension D5/D9): armed for the life of the session; a dead
 *   verdict (404/done/deleted/permanent rejection) freezes capture, and Stop
 *   on a dead session completes locally instead of draining into a void.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { SessionDone } from '../protocol';
import { api, fetchPolicy, permanentStatus, VitrinkaApiError } from './api';
import { eventRoute, setRedactionPolicy } from './capture/redact';
import type { HeldShot } from './capture/shot';
import {
  armReconcile,
  capturesSettled,
  disarmReconcile,
  drainBuffer,
  getState,
  idleMs,
  pushEvent,
  queuedCount,
  resetHealth,
  resetIdle,
  resetQueues,
  type SessionState,
  setState,
} from './queue';

// Re-exported so callers keep a single import site; the definitions live in the
// native-import-free state module (capture layers import them from there).
export { currentRoute, notify, subscribe } from './state';

import { notify } from './state';

// Wire shape from ../protocol, re-exported for existing callers.
export type { SessionDone } from '../protocol';

/**
 * The app id vitrinka resolves project+environment from.
 *
 * The bundle id is the default, but it cannot identify every lane: a
 * TestFlight-style profile may deliberately build the PRODUCTION bundle id
 * (it wants the prod identity + associated domains) — and that is also the
 * real store app's id, so its sessions would be indistinguishable from a
 * production build's. Profiles that need their own lane set
 * `EXPO_PUBLIC_VITRINKA_APP_ID` (e.g. `com.example.app.testflight`) and it
 * wins over the bundle id.
 */
function appId(): string {
  const explicit = process.env.EXPO_PUBLIC_VITRINKA_APP_ID;
  if (explicit) return explicit;
  const bundled =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package;
  if (!bundled) {
    // Loud rather than a silent wrong lane: without an id the server cannot
    // resolve a project, and every session would land in a fallback bucket.
    console.warn('vitrinka: no bundle id resolvable — set EXPO_PUBLIC_VITRINKA_APP_ID');
  }
  return bundled ?? 'unknown.app';
}

/**
 * Re-apply a RECOVERED session's redaction policy after a JS reload — and
 * re-FETCH it when the original fetch never settled: `policy === undefined`
 * means the start-time promise died with the old runtime (null means the
 * fetch completed and failed ⇒ defaults are the final answer). Without the
 * refetch, a reload during the fetch would leave the whole session on the
 * defaults — safe for the built-ins, but workspace extras and maskAllText
 * (screenshot blur) would silently not apply.
 */
let policyRecoveryInFlight = false;

export function recoverRedactionPolicy(): void {
  const rec = getState();
  if (!rec) return;
  setRedactionPolicy(rec.policy ?? null);
  if (rec.policy !== undefined) return;
  // Single-flight: a double-invoked mount effect (React Strict Mode, provider
  // remount) must not race two fetches whose LATER failure could overwrite an
  // EARLIER success with null.
  if (policyRecoveryInFlight) return;
  policyRecoveryInFlight = true;
  void fetchPolicy()
    .then((policy) => {
      const live = getState();
      if (live?.sessionId !== rec.sessionId) return;
      // Settled-policy guard, same reason as the single-flight: once ANY
      // path recorded a final answer (fetched policy, or startSession's own
      // apply), a late recovery response must not clobber it.
      if (live.policy !== undefined) return;
      setRedactionPolicy(policy);
      setState({ ...live, policy });
    })
    .finally(() => {
      // The reset lives in finally, NOT the then: fetchPolicy is contractually
      // non-rejecting today, but that guarantee lives in another module — a
      // future rejection must not leave the flag stuck true and recovery
      // silently dead for the rest of the runtime.
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

/**
 * How a session is started. A human pressing the HUD passes nothing and gets
 * exactly the previous behavior; the devtools control channel (`control.ts`)
 * fills these in for a machine-driven run.
 */
export interface StartOptions {
  title?: string;
  /**
   * Server lane (machine-run design). Omitted for a human start, so the app-id
   * rule resolves the app's own lane as before; the control channel passes
   * "sim". `POST /sessions` honours an explicit environment OVER the app rule.
   */
  environment?: string;
  /** Marks a machine-driven run: minimizes the HUD, recorded in session meta. */
  driver?: 'ai';
  /** Tags to attach right after create (e.g. ['ai', 'sim']). */
  tags?: string[];
  /** Idle auto-stop window in ms (by design); absent or 0 disables it. */
  idleStopMs?: number;
}

export async function startSession(opts: StartOptions = {}): Promise<SessionState> {
  // The safe defaults apply from the first captured byte; the workspace
  // policy (fetched in parallel with the create — fetchPolicy never rejects)
  // can only ADD rules or, self-host only, fullFidelity.
  setRedactionPolicy(null);
  const policyPromise = fetchPolicy();
  const ses = await api<{
    id: string;
    project: string;
    environment: string;
    title: string;
  }>('POST', '/api/v1/sessions', {
    app: appId(),
    title: opts.title || '',
    // Only sent when the caller asked for a specific lane — an empty string
    // would NOT fall through to the app rule, it would be a blank environment.
    ...(opts.environment ? { environment: opts.environment } : {}),
    meta: {
      recorder: 'vitrinka-expo/1',
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version,
      ...(opts.driver ? { driver: opts.driver } : {}),
    },
  });
  // NEVER await the policy here (spec: capture starts under the safe defaults
  // and the policy applies when it lands) — a stalled policy endpoint must not
  // leave the session unstarted and the server row orphaned. The .then cannot
  // fire before the setState below (no await separates them), and it applies
  // only while THIS session is still current.
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
    seq: 0,
    paused: false,
    activeMs: 0,
    resumeAt: new Date().toISOString(),
    shots: 0,
    ...(opts.driver ? { driver: opts.driver } : {}),
    ...(opts.idleStopMs ? { idleStopMs: opts.idleStopMs } : {}),
  });
  await resetQueues();
  resetHealth();
  resetIdle();
  await attachTags(ses.id, opts.tags);
  armReconcile();
  armIdleStop();
  const route = eventRoute();
  pushEvent('nav', { route: route.tabHost }, route);
  notify();
  return getState() as SessionState;
}

/**
 * Attach the session's tags. Deliberately non-fatal: the session already
 * exists and is capturing, and the primary lane separation is the
 * `environment` field carried by the create itself — losing the tag degrades
 * filtering, it does not mix an AI run into the user-testing environment. The
 * failure is logged rather than swallowed so a persistently broken tag route
 * is visible in the Metro console instead of silently eroding the vocabulary.
 */
async function attachTags(sessionId: string, tags: string[] | undefined): Promise<void> {
  if (!tags?.length) return;
  try {
    await api('POST', `/api/v1/sessions/${sessionId}/tags`, { tags });
  } catch (e) {
    console.warn(`vitrinka: could not tag session ${sessionId} with ${tags.join(', ')}`, e);
  }
}

// -- idle auto-stop (machine-run design) -------------------------------------

/**
 * How often the watchdog checks. Coarse on purpose: the window it guards is
 * minutes, and a 30s tick costs nothing next to the 10s reconcile poll.
 */
const IDLE_TICK_MS = 30_000;

let idleTimer: ReturnType<typeof setInterval> | null = null;
let idleTickMs = IDLE_TICK_MS;
/** Guards re-entry: a failed auto-stop must not stack drains 30s apart. */
let autoStopping = false;

/**
 * Test-only: shrink the watchdog tick so a spec can observe an auto-stop
 * without waiting 30 real seconds. Pass no argument to restore the shipped
 * interval. Same escape hatch as `__resetShotThrottleForTests`.
 */
export function __setIdleTickForTests(ms: number = IDLE_TICK_MS): void {
  idleTickMs = ms;
}

export function disarmIdleStop(): void {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
}

/**
 * Arm the idle watchdog for the CURRENT session, if it asked for one. Safe to
 * call repeatedly (it disarms first), which is what lets the provider re-arm a
 * session recovered from MMKV after a JS reload — intervals do not survive one.
 *
 * A paused session goes idle by construction (pushEvent drops while paused), so
 * it auto-stops too. That is the intent: only a machine-driven run sets this
 * window, and nobody is coming back to resume it.
 */
export function armIdleStop(): void {
  disarmIdleStop();
  const rec = getState();
  const window = rec?.idleStopMs ?? 0;
  if (!rec || window <= 0) return;
  idleTimer = setInterval(() => {
    const live = getState();
    const w = live?.idleStopMs ?? 0;
    if (!live || w <= 0) {
      disarmIdleStop();
      return;
    }
    if (autoStopping || idleMs() < w) return;
    autoStopping = true;
    console.warn(
      `vitrinka: no capture for ${Math.round(idleMs() / 1000)}s — auto-stopping session ${live.sessionId}`,
    );
    stopSession()
      .then((done) => {
        console.warn(
          `vitrinka: idle auto-stop complete${done?.board?.url ? ` — ${done.board.url}` : ''}`,
        );
      })
      .catch((e) => {
        // Server unreachable (or a dead-session verdict): the tail stays on
        // disk. stopSession already re-armed reconcile; keep the watchdog
        // armed so the next tick retries once the network is back.
        console.warn('vitrinka: idle auto-stop failed — will retry', e);
        armIdleStop();
      })
      .finally(() => {
        autoStopping = false;
      });
  }, idleTickMs);
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

export function addNote(text: string): void {
  pushEvent('note', { text }, eventRoute());
}

/** A marquee rect in VIEW points (as the gesture reported it). */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalize two corners into a positive-size rect (drags go any direction). */
export function cornersToRect(ax: number, ay: number, bx: number, by: number): ViewRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/**
 * Emit a region annotation: the extension-shaped annotate-note
 * ({text, rect, annotate:true} — vitrinka's projection turns it into a real
 * board annotation region) followed by the frame frozen at drag-release.
 * The rect is scaled to the shot image's pixel space using the held frame's
 * OWN capture scale (screen density normally; the blur downscale under a
 * maskAllText policy). An empty note is still a valid annotation, matching
 * the extension.
 */
export function addAnnotation(text: string, rect: ViewRect, held: HeldShot): void {
  // The HELD FRAME's own capture scale, not the screen density: a blurred
  // keyframe (maskAllText) is only ~96px wide, and density-scaled rects would
  // land far outside it.
  const s = held.scale;
  const px = {
    x: Math.round(rect.x * s),
    y: Math.round(rect.y * s),
    w: Math.round(rect.w * s),
    h: Math.round(rect.h * s),
  };
  const ts = pushEvent('note', { text, rect: px, annotate: true }, eventRoute());
  // A dropped note (session ended / paused mid-compose) must not emit an
  // orphan keyframe — the rect would have nothing binding to it.
  if (ts) held.commit(ts);
  else held.discard();
}

/**
 * Stop the session. Throws with the queued-item count when the server is
 * unreachable — the durable tail is NEVER deleted; capture freezes paused
 * and a later Stop finishes the job once online.
 */
export async function stopSession(): Promise<SessionDone | null> {
  const rec = getState();
  if (!rec) return null;
  // Our own stop must not race the reconcile poll: between the PATCH below and
  // setState(null) a tick would see status "done" and mark our own stop "dead".
  disarmReconcile();
  // Same reasoning for the idle watchdog — a tick landing mid-drain would
  // start a second stop on a session this one is already closing.
  disarmIdleStop();
  // The server refused this session (extension D9) — draining or PATCHing can
  // never succeed. Complete the stop locally in ONE press; what was uploaded
  // before the verdict still projects on the server. Used both for a session
  // already dead at entry AND for a verdict that surfaces mid-drain below.
  const completeDeadStop = async (reason: string | undefined): Promise<never> => {
    const kept = queuedCount();
    setState(null);
    setRedactionPolicy(null);
    await resetQueues();
    notify();
    throw new Error(
      `${reason || 'session rejected by the server'} — recording ended locally` +
        (kept ? `; ${kept} undelivered item(s) discarded` : ''),
    );
  };
  if (rec.dead) await completeDeadStop(rec.deadReason);
  // Settle every in-flight capture BEFORE the drain snapshot: the tap on Stop
  // itself starts a keyframe (which allocates its seq ~80ms later), and network
  // body reads complete off the caller's critical path. Either could otherwise
  // append after the snapshot, leaving the session PATCHed done without it.
  //
  // BOUNDED wait: a capture may never finish (a long-lived stream body read), so
  // Stop proceeds after the deadline rather than hanging. A late event is a
  // strictly better outcome than an un-stoppable recording — it stays on disk
  // and this run just doesn't carry it.
  if (!(await capturesSettled())) {
    console.warn(
      'vitrinka: stopping with unsettled captures — a late event may not make this session',
    );
  }
  if (!(await drainBuffer())) {
    const held = getState();
    if (held?.dead) {
      // The verdict surfaced inside the drain THIS stop started — complete
      // the stop locally right here, one press.
      await completeDeadStop(held.deadReason);
    }
    if (held && !held.paused) {
      held.activeMs = elapsedOf(held);
      held.paused = true;
      held.resumeAt = null;
      setState(held);
    }
    armReconcile(); // the session lives on — keep watching the server
    notify();
    throw new Error(
      `server unreachable — ${queuedCount()} item(s) kept on disk; stop again once online`,
    );
  }
  let done: SessionDone | null = null;
  try {
    done = await api<SessionDone>('PATCH', `/api/v1/sessions/${rec.sessionId}`, { status: 'done' });
  } catch (e) {
    if (e instanceof VitrinkaApiError && permanentStatus(e.status)) {
      // Session deleted / auth revoked: retrying can never succeed —
      // complete the stop locally so the user isn't wedged.
      console.warn('vitrinka: stop rejected permanently — clearing local session', e);
    } else {
      console.warn('vitrinka: stop PATCH failed — session kept', e);
      armReconcile(); // the session lives on — keep watching the server
      throw e;
    }
  }
  setState(null);
  setRedactionPolicy(null);
  await resetQueues();
  notify();
  return done;
}
