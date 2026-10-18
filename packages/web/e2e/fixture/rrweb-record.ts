/**
 * Stand-in for vitrinka's `/vendor/rrweb-record-1.min.js`: rrweb's recorder
 * as an ES module. report.spec.ts bundles it so the single-file widget loads
 * its recorder exactly as it does from a deployment. The first `record()`
 * call sets `window.__rrwebRecording`, so a spec can wait for the recorder to
 * run rather than for its script to be asked for.
 */
import { record as rrwebRecord } from 'rrweb';

// A new binding on purpose: `bun build` drops rrweb's import from a plain re-export.
// The statics (takeFullSnapshot, mirror) ride along: the widget reads them off `record`.
export const record = Object.assign((...args: Parameters<typeof rrwebRecord>) => {
  const stop = rrwebRecord(...args);
  (globalThis as { __rrwebRecording?: boolean }).__rrwebRecording = true;
  return stop;
}, rrwebRecord);
