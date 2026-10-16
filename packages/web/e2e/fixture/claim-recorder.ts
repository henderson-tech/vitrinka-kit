/**
 * A host's npm recorder, as far as the capture runtime goes: its OWN bundled
 * copy of `state.ts`, separate from the one inside report-widget.mjs, claiming
 * the page's capture the way `RecorderProvider` does on mount. report.spec.ts
 * proves the two copies agree on one owner.
 */
import { claimCapture, releaseCapture } from '../../src/recorder/state';

let token: string | null = null;

(globalThis as typeof globalThis & { vtRecorder?: { mount(): void; unmount(): void } }).vtRecorder = {
  mount: () => {
    token = claimCapture('recorder');
  },
  unmount: () => {
    releaseCapture(token);
    token = null;
  },
};
