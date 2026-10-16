/**
 * `face: 'recorder'` (QA Studio D6): the same engine with the recorder pill
 * as its face — `VitrinkaRecorderRoot` + `VitrinkaRecorderPill` rendered
 * into a detached root of their own. Loaded lazily by the npm entry only, so
 * a report-only host never pays for React or the recorder.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { VitrinkaRecorderPill, VitrinkaRecorderRoot } from '../recorder';
import type { RecorderFaceOptions } from './element';

export function mountRecorderFace(opts: RecorderFaceOptions): () => void {
  const container = document.createElement('div');
  container.hidden = true;
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    createElement(
      VitrinkaRecorderRoot,
      { url: opts.base, recorderKey: opts.key, appVersion: opts.appVersion, sanitizeUrl: opts.sanitizeUrl },
      createElement(VitrinkaRecorderPill),
    ),
  );
  return () => {
    root.unmount();
    container.remove();
  };
}
