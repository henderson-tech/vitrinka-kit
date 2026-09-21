/**
 * rrweb lane — the DOM stream is the session's keyframe (no screenshots).
 * Batched every 2s into chunks the way the extension does; `maskDirectives`
 * from the active redaction rules drive rrweb's own masking (inputs always,
 * all text under a `maskAllText` policy). The HUD host is blocked from the
 * recording so the pill never appears in replay.
 */
import type { eventWithTime } from '@rrweb/types';
import { record } from 'rrweb';

import { pushRRWebBatch } from '../queue';
import { currentRoute } from '../state';
import { maskDirectives } from './redact';

const BATCH_MS = 2000;
/** A fresh full snapshot every 5 min keeps long recordings seekable. */
const CHECKOUT_MS = 5 * 60 * 1000;
/** Elements carrying this attribute are never recorded (the HUD host). */
export const RRWEB_BLOCK_ATTR = 'data-vitrinka-recorder';

let stop: (() => void) | null = null;
let buf: eventWithTime[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function ship(): void {
  if (!buf.length) return;
  const events = buf;
  buf = [];
  // Not capturing (paused): the batch is dropped on purpose — paused means
  // paused, and the next resume starts from a fresh checkout.
  pushRRWebBatch(events, { tabId: currentRoute.tabId, tabHost: currentRoute.tabHost });
}

/** Start recording the DOM; idempotent. */
export function startRRWeb(): void {
  if (stop) return;
  const mask = maskDirectives();
  try {
    const stopFn = record({
      emit: (ev) => {
        buf.push(ev);
      },
      checkoutEveryNms: CHECKOUT_MS,
      inlineImages: true,
      collectFonts: true,
      maskAllInputs: mask.maskAllInputs,
      ...(mask.maskTextSelector ? { maskTextSelector: mask.maskTextSelector } : {}),
      blockSelector: `[${RRWEB_BLOCK_ATTR}]`,
    });
    stop = stopFn ?? null;
  } catch (e) {
    console.warn('vitrinka: rrweb failed to start', e);
    return;
  }
  timer = setInterval(ship, BATCH_MS);
}

/** Ship the tail and stop recording. */
export function stopRRWeb(): void {
  if (timer) clearInterval(timer);
  timer = null;
  ship();
  try {
    stop?.();
  } catch {
    // already torn down
  }
  stop = null;
  buf = [];
}

/** Take a fresh full snapshot (resume after pause, policy change). */
export function checkoutRRWeb(): void {
  if (!stop) return;
  try {
    record.takeFullSnapshot?.(true);
  } catch {
    // older rrweb — the periodic checkout covers it
  }
}

/** Flush the current batch now (pagehide, stop). */
export function flushRRWeb(): void {
  ship();
}
