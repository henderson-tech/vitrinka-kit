# @vitrinka/web

## 0.1.1

- **The recorder never changes the page under test**: rrweb records images by
  URL (`inlineImages: false`). Inlining made rrweb set
  `crossOrigin="anonymous"` on the page's own no-CORS cross-origin `<img>`,
  which refetched it in CORS mode and broke it on hosts without ACAO.
- **Link into the right workspace**: a `url` addressing `/w/<slug>`
  preselects that workspace on the approve page, and a token approved into
  any other one is discarded; the link sheet says `linked into <x> — this app
  records into <slug>; link again and pick <slug>`. Needs `@vitrinka/link`
  ≥ 0.1.1.

## 0.1.0

- Initial release: the React DOM journey recorder (`@vitrinka/web/recorder`)
  — rrweb DOM stream (chunked like the browser extension), DOM clicks,
  navigation, `console.error` / uncaught errors, fetch/XHR with
  `@vitrinka/redact`; the pill HUD in a top-layer shadow host with notes,
  element/region annotations and keyboard shortcuts; `window.__vitrinkaRecorder`
  control handle; `withVitrinkaRecorder` (`@vitrinka/web/next`) build guard.
- Device link: no key needed — the pill links the device (`@vitrinka/link`),
  stores the minted token under `vitrinka.recorder.link`; `recorderKey` is
  for CI. The runtime strip is the URL alone.
