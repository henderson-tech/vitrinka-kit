/**
 * Screenshot keyframes — react-native-view-shot captureRef on the recorder's
 * root wrapper (design decision), throttled like the extension's
 * captureVisibleTab path. Direct upload keeps the allocated seq; a failed
 * upload persists the JPEG to disk and rides the pending queue, gap-filling
 * the stream on a later retry.
 */

import { deleteAsync } from 'expo-file-system/legacy';
import type { RefObject } from 'react';
import { Dimensions, PixelRatio, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { eventRoute, pixelPolicy } from './redact';

import { uploadShot } from '../api';
import {
  countShot,
  getState,
  isSessionLive,
  nextSeq,
  persistShotFile,
  pushRawEvent,
  queuePendingShot,
  scheduleFlush,
  trackCapture,
} from '../queue';
import { notify } from '../state';

const SHOT_THROTTLE_MS = 700;

/**
 * Downscale width used when the workspace policy demands pixel masking
 * (`maskAllText` ⇒ pixelPolicy 'blur'). Screenshots carry real rendered text
 * — there is no DOM to mask — so the frame is captured at a resolution where
 * text is unreadable while layout, color and navigation state survive.
 */
const BLUR_WIDTH = 96;

/**
 * captureRef sizing for the active redaction rules: normal captures pass no
 * size (full fidelity of the frame); under 'blur' the output is resized to
 * BLUR_WIDTH keeping the window's aspect ratio.
 */
function blurCaptureOpts(): { width: number; height: number } | Record<string, never> {
  if (pixelPolicy() !== 'blur') return {};
  const { width, height } = Dimensions.get('window');
  const aspect = width > 0 && height > 0 ? height / width : 2;
  return { width: BLUR_WIDTH, height: Math.max(1, Math.round(BLUR_WIDTH * aspect)) };
}

/**
 * Captured-image pixels per view POINT for a capture taken right now: screen
 * density normally, BLUR_WIDTH / window width under 'blur'. Annotation rects
 * must convert with THIS scale — a blurred frame is only BLUR_WIDTH px wide,
 * so density-scaled coordinates would land far outside the image.
 */
function captureScale(): number {
  if (pixelPolicy() !== 'blur') return PixelRatio.get();
  const { width } = Dimensions.get('window');
  return width > 0 ? BLUR_WIDTH / width : 1;
}

/** Release a temp capture we are not going to send. */
function discardTmp(uri: string): void {
  void deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

let rootRef: RefObject<View | null> | null = null;
let lastShot = 0;
let inFlight: Promise<void> | null = null;

export function setShotRoot(ref: RefObject<View | null>): void {
  rootRef = ref;
}

/** Test-only: clear the throttle so consecutive cases each get a capture. */
export function __resetShotThrottleForTests(): void {
  lastShot = 0;
  inFlight = null;
}

/**
 * Start a keyframe capture. The in-flight promise is published to the queue
 * layer so Stop can settle it before draining: the tap on Stop itself starts a
 * screenshot which allocates its seq ~80ms later, i.e. after the drain snapshot
 * — the session would be PATCHed done with that seq missing.
 */
export function shoot(reason: 'nav' | 'touch' | 'start'): Promise<void> {
  const rec = getState();
  if (!rec || rec.paused || rec.dead || !rootRef?.current) return Promise.resolve();
  const now = Date.now();
  if (now - lastShot < SHOT_THROTTLE_MS || inFlight) return Promise.resolve();
  lastShot = now;
  const run = trackCapture(doShoot(reason)).finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}

/**
 * A keyframe frozen at annotate drag-release, waiting for its note. The frame
 * is captured (and its seq allocated) IMMEDIATELY — before the composer or
 * keyboard can appear — so the annotation rect refers to exactly the pixels
 * the tester circled. `commit(noteTs)` emits it with ts = noteTs + 1ms: the
 * projection walks events by (ts, seq), so the annotate-note lands just before
 * THIS shot and its rect binds to this frame (pendingAnnots in vitrinka's
 * handlers_session_project.go). `discard` releases the temp JPEG; the seq gap
 * it leaves behind is fine (the ingest contract tolerates gaps).
 */
export interface HeldShot {
  /**
   * Captured-image pixels per view POINT for THIS frame (screen density, or
   * BLUR_WIDTH/window-width when the frame was captured blurred). Annotation
   * rects convert view points to image pixels with this scale.
   */
  scale: number;
  commit(noteTs: string): void;
  discard(): void;
}

/**
 * Capture and hold a keyframe for the annotate flow. Bypasses the throttle —
 * a deliberate annotation always deserves its own frame. Returns null when
 * there is no live unpaused session or the capture fails.
 */
export async function captureHeldShot(): Promise<HeldShot | null> {
  const rec = getState();
  if (!rec || rec.paused || rec.dead || !rootRef?.current) return null;
  const origin = rec.sessionId;
  let tmpUri: string;
  let frameScale = 1;
  try {
    // Let the marquee's final frame paint before freezing it.
    await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 80)));
    if (!isSessionLive(origin) || !rootRef.current) return null;
    // Freeze the scale at capture time — a policy flip between the capture
    // and the note commit must not desync rect space from the pixels.
    frameScale = captureScale();
    tmpUri = await captureRef(rootRef.current, {
      format: 'jpg',
      quality: 0.7,
      result: 'tmpfile',
      ...blurCaptureOpts(),
    });
  } catch (e) {
    console.warn('vitrinka: annotate captureRef failed', e);
    return null;
  }
  if (!isSessionLive(origin)) {
    discardTmp(tmpUri);
    return null;
  }
  // Allocate the seq NOW: it must predate any seq the note (or unrelated
  // captures) allocate while the composer is open.
  const seq = nextSeq();
  if (seq === null) {
    discardTmp(tmpUri);
    return null;
  }
  const route = eventRoute();
  let settled = false;
  return {
    scale: frameScale,
    commit: (noteTs) => {
      if (settled) return;
      settled = true;
      void trackCapture(commitHeldShot(origin, seq, tmpUri, route, noteTs));
    },
    discard: () => {
      if (settled) return;
      settled = true;
      discardTmp(tmpUri);
    },
  };
}

/** Upload + emit a held keyframe. Same retry discipline as doShoot. */
async function commitHeldShot(
  origin: string,
  seq: number,
  tmpUri: string,
  route: { tabId: string; tabHost: string },
  noteTs: string,
): Promise<void> {
  if (!isSessionLive(origin)) return void discardTmp(tmpUri);
  countShot();
  notify();
  // 1ms after the note: later than the note, earlier than anything else.
  const ts = new Date(Date.parse(noteTs) + 1).toISOString();
  const payload = { route: route.tabHost, reason: 'annotate' };
  try {
    const up = await uploadShot(origin, seq, tmpUri);
    if (!isSessionLive(origin)) return void discardTmp(tmpUri);
    pushRawEvent({
      seq,
      ts,
      tabId: route.tabId,
      tabHost: route.tabHost,
      kind: 'shot',
      blobKey: up.blobKey,
      payload,
    });
    // Blob delivered — the temp JPEG must not outlive the commit (one leaked
    // file per annotation otherwise).
    discardTmp(tmpUri);
  } catch (e) {
    console.warn('vitrinka: annotate shot upload failed — queued for retry', e);
    const fileUri = await persistShotFile(tmpUri, seq);
    await queuePendingShot({
      seq,
      ts,
      tabId: route.tabId,
      tabHost: route.tabHost,
      sessionId: origin,
      payload,
      fileUri,
    });
    scheduleFlush();
  }
}

async function doShoot(reason: 'nav' | 'touch' | 'start'): Promise<void> {
  const rec = getState();
  if (!rec || !rootRef?.current) return;
  // The session this keyframe belongs to. Every await below is a point where
  // Stop may have completed (its capture wait is deadline-bounded since
  // and a NEW session may have started: without re-checking, a slow
  // capture allocated a seq from session B, uploaded under session A's id, and
  // pushed the event into B's stream.
  const origin = rec.sessionId;
  try {
    // Let the frame that triggered the shot (navigation transition, ripple)
    // actually paint before capturing.
    await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 80)));
    if (!isSessionLive(origin) || !rootRef.current) return;
    // From here on a temp JPEG exists on disk, so every early return must clean
    // it up — an abandoned keyframe otherwise leaks a file per capture that
    // outlived its session.
    const tmpUri = await captureRef(rootRef.current, {
      format: 'jpg',
      quality: 0.7,
      result: 'tmpfile',
      ...blurCaptureOpts(),
    });
    // Allocate the seq only while the ORIGIN session is still current.
    if (!isSessionLive(origin)) return void discardTmp(tmpUri);
    const seq = nextSeq();
    if (seq === null) return void discardTmp(tmpUri);
    countShot();
    notify();
    const ts = new Date().toISOString();
    const route = eventRoute();
    const payload = { route: route.tabHost, reason };
    try {
      const up = await uploadShot(origin, seq, tmpUri);
      // The blob is already on the server; without its pointer event it is
      // unreferenced, which the server's own retention handles. Locally we still
      // release the temp file rather than leaking it.
      if (!isSessionLive(origin)) return void discardTmp(tmpUri);
      pushRawEvent({
        seq,
        ts,
        tabId: route.tabId,
        tabHost: route.tabHost,
        kind: 'shot',
        blobKey: up.blobKey,
        payload,
      });
      // Delivered — release the temp file on the success path too (it used to
      // linger for the life of the process, one JPEG per keyframe).
      discardTmp(tmpUri);
    } catch (e) {
      // Not lost: the JPEG rides the disk-backed pending queue and retries
      // ahead of the next flushes, keeping its allocated seq.
      console.warn('vitrinka: shot upload failed — queued for retry', e);
      const fileUri = await persistShotFile(tmpUri, seq);
      // Still bound to `origin`: the pending drain drops items whose session
      // is gone, which is the correct outcome for a keyframe that outlived it.
      await queuePendingShot({
        seq,
        ts,
        tabId: route.tabId,
        tabHost: route.tabHost,
        sessionId: origin,
        payload,
        fileUri,
      });
      scheduleFlush();
    }
  } catch (e) {
    console.warn('vitrinka: captureRef failed', e);
  }
}
