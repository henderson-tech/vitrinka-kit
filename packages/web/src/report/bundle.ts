/**
 * Entry of `build/report-widget.mjs`: Report a problem as ONE self-contained
 * ES module — no React, no package imports — that vitrinka serves as
 * `/vendor/report-widget-1.mjs`. Loading it defines `<vitrinka-report>`:
 *
 *   <script type="module" src="https://vitrinka.example/vendor/report-widget-1.mjs"></script>
 *   <vitrinka-report key="vkb_…"></vitrinka-report>
 *
 * Its one runtime import is rrweb's recorder, loaded lazily (only when the
 * project's capture profile records the page) from the same deployment:
 * `<base>/vendor/rrweb-record-1.min.js`. `base` defaults to the origin this
 * module was served from. The recorder face is not in this build.
 */
import type { RecordFn } from '../recorder/capture/rrweb-lane';
import { defineReportElement, type Faces, mountReport as mount, type ReportHandle, type ReportOptions } from './element';

export { identify } from './identity';

/** The origin this module was served from — the deployment, by default. */
const SELF_ORIGIN = (() => {
  try {
    return new URL(import.meta.url).origin;
  } catch {
    return '';
  }
})();

/** rrweb's `record` from the deployment's pinned recorder (a default export, or a `record` on it or the module). */
async function loadVendorRecord(base: string): Promise<RecordFn | null> {
  // boundary: foreign untyped code — narrowed structurally below.
  const m: unknown = await import(/* @vite-ignore */ `${base}/vendor/rrweb-record-1.min.js`);
  const mod = (m ?? {}) as { default?: unknown; record?: unknown };
  const inner = typeof mod.default === 'object' && mod.default !== null ? (mod.default as { record?: unknown }).record : undefined;
  const candidate = typeof mod.default === 'function' ? mod.default : (inner ?? mod.record);
  return typeof candidate === 'function' ? (candidate as RecordFn) : null;
}

const faces: Faces = {
  loadRecord: loadVendorRecord,
  recorderFace: null,
  defaultBase: () => SELF_ORIGIN,
};

defineReportElement(faces);

/** Mount Report a problem from script; `base` defaults to this module's origin. */
export function mountReport(opts: ReportOptions): ReportHandle {
  return mount(opts, faces);
}
