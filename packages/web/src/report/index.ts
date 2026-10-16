/**
 * `@vitrinka/web/report` — Report a problem (QA Studio D6/D12): the report
 * face of the one capture client. The same module ships as one file,
 * `@vitrinka/web/report-widget.mjs`, which vitrinka serves as
 * `/vendor/report-widget-1.mjs` (bundle.ts).
 *
 *   import { mountReport } from '@vitrinka/web/report';
 *   const report = mountReport({ key: 'vkb_…', base: 'https://vitrinka.example', locale: 'cs' });
 *   report.identify({ token });   // a token your server signed
 *   report.setLocale('en');       // live, the draft survives
 *
 * Or the tag: call `defineReportElement()` once, then `<vitrinka-report key=… base=…>`.
 * rrweb (a peer dependency) loads lazily, when the project's profile records
 * the page; `face: 'recorder'` loads React and the recorder pill lazily.
 */
import type { RecordFn } from '../recorder/capture/rrweb-lane';
import { defineReportElement as define, type Faces, mountReport as mount, type ReportHandle, type ReportOptions } from './element';

export type { CaptureClass, CaptureNarrowing, CaptureProfile, CaptureStorage } from './profile';
export type { Locale } from './i18n';
export type { IdentifyInput, Identity } from './identity';
export type { Marker, MarkerShape, WireMarker } from './markers';
export type { ReportEnvelope, SubmitReply } from './wire';
export type { ReportFace, ReportHandle, ReportOptions, ReportScriptOptions, VitrinkaReportElement } from './element';
export { identify } from './identity';

const faces: Faces = {
  loadRecord: (): Promise<RecordFn> => import('rrweb').then((m) => m.record),
  recorderFace: () => import('./recorder-face').then((m) => m.mountRecorderFace),
  defaultBase: () => '',
};

/** Mount Report a problem (default) or the recorder pill (`face: 'recorder'`). */
export function mountReport(opts: ReportOptions): ReportHandle {
  return mount(opts, faces);
}

/** Define `<vitrinka-report>` (idempotent; mountReport calls it). */
export function defineReportElement(): void {
  define(faces);
}
