/**
 * rrweb lane — the DOM stream is the session's keyframe (no screenshots).
 * The recorder face's binding of the shared lane (rrweb-lane.ts) to the
 * statically imported `rrweb`: the live session's 2 s chunks, or the idle
 * pill's flight recorder (`startFlightRRWeb`) under the buffer's profile.
 */
import { record } from 'rrweb';

import { startRecordWith } from './rrweb-lane';

export { checkoutRRWeb, flushRRWeb, RRWEB_BLOCK_ATTR, stopRRWeb } from './rrweb-lane';

/** Start recording the DOM into the live session; idempotent. */
export function startRRWeb(): void {
  startRecordWith(record, 'session');
}

/**
 * Start recording the DOM into the idle pill's flight recorder (flight.ts):
 * a checkout per the buffer's profile, each event straight into its windows.
 * Idempotent; `stopRRWeb` stops it.
 */
export function startFlightRRWeb(): void {
  startRecordWith(record, 'flight');
}
