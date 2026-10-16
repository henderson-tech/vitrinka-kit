/**
 * The rrweb lane with its recorder passed in — the one DOM-stream capture
 * both faces share (QA Studio D6). `capture/rrweb.ts` binds it to the
 * statically imported `rrweb` (the recorder face); the report face passes a
 * lazily loaded one (`import('rrweb')` from npm, vitrinka's
 * `/vendor/rrweb-record-1.min.js` in the single-file widget), so nothing here
 * imports rrweb's runtime.
 *
 * Batched every 2 s into chunks the way the extension does; `maskDirectives`
 * from the active redaction rules drive rrweb's own masking (inputs always,
 * all text under a `maskAllText` policy — a subtree under the caller's
 * `unmaskSelector` keeps its text), and every event passes
 * `redactRRWebEvent` before it is buffered (the Meta event's page URL loses
 * its query/fragment secrets). The HUD host is blocked from the recording
 * so no recorder surface ever appears in replay. While no session is live
 * the same lane feeds the flight buffer instead (flight.ts): same masking,
 * same scrub, its profile's checkout interval, and the overflow checkout it
 * registers there.
 */
import type { eventWithTime } from '@rrweb/types';
import type { record as rrwebRecord } from 'rrweb';

import { RRWEB_BLOCK_ATTR } from '../block';
import { flightProfile, pushFlightRRWeb, setFlightCheckout } from '../flight';
import { pushRRWebBatch } from '../queue';
import { currentRoute } from '../state';
import { maskDirectives, redactRRWebEvent } from './redact';

export { RRWEB_BLOCK_ATTR };

/** rrweb's `record` (with its static `takeFullSnapshot` and `mirror`). */
export type RecordFn = typeof rrwebRecord;

export interface RRWebLaneOptions {
  /** Under a mask-all-text policy, subtrees matching this keep their text (inputs stay masked). */
  unmaskSelector?: string;
}

const BATCH_MS = 2000;
/** A fresh full snapshot every 5 min keeps long recordings seekable. */
const CHECKOUT_MS = 5 * 60 * 1000;

let stop: (() => void) | null = null;
let running: RecordFn | null = null;
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

/** The recorder the lane runs on now (its `mirror` maps live nodes to ids), else null. */
export function runningRecord(): RecordFn | null {
  return running;
}

/** Start recording the DOM into the live session (`'session'`) or the flight buffer; idempotent. */
export function startRecordWith(record: RecordFn, sink: 'session' | 'flight', opts: RRWebLaneOptions = {}): void {
  if (stop) return;
  const mask = maskDirectives();
  const unmask = opts.unmaskSelector;
  try {
    const stopFn = record({
      // Scrubbed on the way in: nothing raw ever sits in the buffer.
      emit:
        sink === 'flight'
          ? (ev) => pushFlightRRWeb(redactRRWebEvent(ev))
          : (ev) => {
              buf.push(redactRRWebEvent(ev));
            },
      checkoutEveryNms: sink === 'flight' ? flightProfile().checkoutMs : CHECKOUT_MS,
      // Never inline: to read a no-CORS cross-origin image rrweb sets
      // crossOrigin='anonymous' on the page's own <img>, the browser refetches
      // it in CORS mode and a host without ACAO shows a broken image — the
      // recorder must never change the page under test. Replay loads by URL.
      inlineImages: false,
      collectFonts: true,
      maskAllInputs: mask.maskAllInputs,
      ...(mask.maskTextSelector ? { maskTextSelector: mask.maskTextSelector } : {}),
      ...(mask.maskTextSelector && unmask
        ? {
            maskTextFn: (text: string, el: HTMLElement | null) => {
              try {
                if (el?.closest(unmask)) return text;
              } catch {
                // a detached or exotic node: mask it
              }
              return text.replace(/\S/g, '*');
            },
          }
        : {}),
      blockSelector: `[${RRWEB_BLOCK_ATTR}]`,
    });
    stop = stopFn ?? null;
  } catch (e) {
    console.warn('vitrinka: rrweb failed to start', e);
    return;
  }
  running = record;
  if (sink === 'flight') setFlightCheckout(checkoutRRWeb);
  if (sink === 'session') timer = setInterval(ship, BATCH_MS);
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
  running = null;
  setFlightCheckout(null);
  buf = [];
}

/** Take a fresh full snapshot (resume after pause, policy change, a buffer over its cap). */
export function checkoutRRWeb(): void {
  if (!stop || !running) return;
  try {
    running.takeFullSnapshot?.(true);
  } catch {
    // older rrweb — the periodic checkout covers it
  }
}

/** Flush the current batch now (pagehide, stop). */
export function flushRRWeb(): void {
  ship();
}
