/**
 * Stand-in for vitrinka's `/vendor/rrweb-record-1.min.js`: rrweb's recorder
 * as an ES module. report.spec.ts bundles it so the single-file widget loads
 * its recorder exactly as it does from a deployment.
 */
import { record as rrwebRecord } from 'rrweb';

// The module being fetched is not the recorder running: the widget starts it
// only once the import resolves, and a card opened before that freezes a clip
// with no screen, so its report carries no recording. The specs wait for this
// count (`globalThis.__rrwebStarted`), never for the request alone.
// rrweb's statics ride along unchanged: the widget's checkouts call
// record.takeFullSnapshot and read record.mirror.
// A new binding on purpose: `bun build` drops rrweb's import from a plain re-export.
export const record = Object.assign(
  (...args: Parameters<typeof rrwebRecord>) => {
    const stop = rrwebRecord(...args);
    const g = globalThis as { __rrwebStarted?: number };
    g.__rrwebStarted = (g.__rrwebStarted ?? 0) + 1;
    return stop;
  },
  {
    addCustomEvent: rrwebRecord.addCustomEvent,
    freezePage: rrwebRecord.freezePage,
    takeFullSnapshot: rrwebRecord.takeFullSnapshot,
    mirror: rrwebRecord.mirror,
  },
);
