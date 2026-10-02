# @vitrinka/web

## 0.2.1

- **Linking survives a flaky network.** One failed approval check (a
  dropped connection, an edge error page, a 5xx or a 429) used to end the
  link with "Failed to fetch · Try again", even though the code was still
  valid. Now the pill keeps waiting: it retries with a growing pause (up to
  30s) until the code itself expires. Only an expired code, a token for
  another workspace or Cancel ends it. Needs `@vitrinka/link` 0.1.3.
- **No more passive-listener errors on Angular hosts.** On a page that runs
  zone.js (any Angular app), Esc in the menu, the note sheet or annotate
  mode logged "Unable to preventDefault inside passive event listener
  invocation", and the browser went ahead with the default anyway. zone.js
  runs every listener of a kind through the first one registered, and
  Angular CDK registers its keydown, mousedown and touchstart listeners as
  passive. The HUD now registers every listener that cancels an event
  directly with the browser, never passive.

## 0.2.0

- **Stop is in the pill.** A ■ next to the other tools. It asks inline
  ("Stop & save? Stop · Keep recording"; Esc or Keep cancels). Then the pill
  says **Saving…**, with a spinner and a progress bar while the tail drains.
  Then it says **Saved · Open board**, with the server's board link. That
  stays until you dismiss it. If the server cannot be reached, the pill says
  so and offers **Retry**. Nothing is lost. Unlink asks the same way.
- **Recents and the account.** The ⋯ menu (now on the idle puck too) names
  who the recorder is linked as: `you@… · Workspace`, or `Recorder key ·
  <name> · project <p>` for a key build. It lists the device's last five
  recordings, with age, length, status and a link to each board. It has
  **Go to vitrinka**. A recent without a board link is refreshed from the
  session's own read.
- **Eight spots, and a vertical pill.** Move to is a miniature screen with
  eight spots: a 3×3 grid without the centre. At middle left and middle
  right, the recording pill stands up and becomes vertical. Its menu,
  tooltips and sheets open sideways. A pushed-away tab comes back to the
  nearest third of its edge.
- **Tooltips never clip.** There is one tooltip, and it shows the shortcut.
  It is placed inside the viewport, flipping and shifting as needed from
  every spot. Menus, sheets and the details card follow the same placement.
- **A sync chip you can read.** `synced`, `sending N`, `offline · N` or
  `ended`, with an icon and a colour for each, and no hover needed. A routine
  2s flush does not flicker it.
- **Size and technical details.** S · M · L scales the whole HUD. Technical
  details shows events, queue and chunks, last sync, server seq, session id
  and recorder version. Both are user prefs (`GET`/`PATCH
  /api/v1/recorder/me`) and are cached on the device. They stay on the
  device for key builds, servers without the route, and offline.
- **"Saved" on the pill** for a moment after a note or annotation.
- **Annotate does not touch the page.** A drag over text no longer selects
  it. Presses, moves and hovers no longer reach the app. The crosshair is
  set by a blocked stylesheet, so the page's `<html>` is never restyled.
- The record dot's ripple is drawn outside layout, so the dot and the clock
  are spaced evenly.
- **The HUD is a seam.** `@vitrinka/web/hud` exports
  `mountRecorderHud(controller, opts)` and the `HudController` contract. The
  in-page recorder is one implementation of it. `build/hud.iife.js`
  (`@vitrinka/web/hud.iife.js`) is the same mount as one self-contained
  script with React bundled in. It defines `globalThis.VitrinkaHud.mount`.
- The HUD's surfaces stay out of the recording. The rrweb-blocked host is
  0×0. rrweb 2 cannot drop a blocked node entirely, so it leaves an empty,
  zero-size placeholder. Clicks, the recorder's own requests and `vitrinka:`
  logs are not captured.

## 0.1.5

- **A `project` prop.** `VitrinkaRecorderRoot` takes `project`. A
  device-linked session then files into that project instead of the one the
  host's rule picks. One origin that serves several apps by path can now send
  each app's sessions to its own project. A recorder key's pin still wins.

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
