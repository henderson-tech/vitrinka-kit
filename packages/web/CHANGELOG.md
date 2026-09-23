# @vitrinka/web

## 0.1.4

- **Annotate works by finger.** On a phone or tablet, a drag in annotate
  mode used to scroll the page: the browser took the gesture and the
  marquee froze where it was. The next tap then quit annotate mode without
  picking anything. Now annotate mode owns every touch on the page, so a
  drag draws the region, and the page no longer pans, zooms, selects text
  or opens a long-press menu. Leaving annotate mode gives all of that back.
  If the browser does take a gesture, the marquee clears and you stay in
  annotate mode.
- **A pick never presses the page.** Tapping or clicking a button to
  annotate it also pressed the button, on desktop too, and the journey
  recorded the pick as a click. The pick's click is now swallowed, even
  after annotate mode has closed.
- Finger taps get a 12px slop before they become a marquee (a mouse keeps
  6px). A slip that draws only a sliver stays in annotate mode instead of
  quitting it, and a second finger never moves the marquee.

## 0.1.3

- **A throw over a page link or image lands.** Grabbing the HUD where the
  page has a link or image underneath could start the browser's native drag
  of that element. The browser then cancelled the pointer, and the HUD snapped
  back to its spot. A press on the capsule, the puck or the tab now blocks
  native drags until it ends.

## 0.1.2

- **A HUD that is barely there.** Idle, it is a 28px glass puck (a hollow
  ring until the device is linked) whose label slides out on hover or focus.
  While recording it rests as a dot-and-timer capsule and unfolds into the
  tools (sync · pause · note · annotate · more) on hover, focus or tap,
  folding back 2.5s after you leave; the health line still opens by itself
  when something is wrong. Smoked-glass surface, readable on light and dark
  pages. Accessible names are unchanged; the capsule is `Recorder controls`
  (`aria-expanded`), and a polite status line tells screen readers whether
  it is recording, paused or offline.
- **Move it anywhere.** Drag the capsule or puck and it lands on one of six
  spots (corners, top and bottom centre); a flick lands where it is thrown.
  Push it past a side edge and it tucks into a 6px tab (`Show recorder`).
  Arrow keys on the focused handle and the menu's **Move to** picker move it
  without dragging. The spot is remembered per site.
- **Sheets open toward the page centre** from wherever the HUD sits, at most
  288px wide; on a phone they are a bottom sheet above the keyboard, and the
  link sheet drops the QR on touch devices (a phone cannot scan itself).
- `prefers-reduced-motion` stills the ripple, the springs and the slides.
- Needs `@vitrinka/link` 0.1.2 (`@vitrinka/link/dock`).

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
