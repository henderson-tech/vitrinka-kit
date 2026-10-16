/**
 * Stand-in for vitrinka's `/vendor/rrweb-record-1.min.js`: rrweb's recorder
 * as an ES module. report.spec.ts bundles it so the single-file widget loads
 * its recorder exactly as it does from a deployment.
 */
import { record as rrwebRecord } from 'rrweb';

// A new binding on purpose: `bun build` drops rrweb's import from a plain re-export.
export const record = rrwebRecord;
