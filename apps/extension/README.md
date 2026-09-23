# Vitrinka Journey Recorder (browser extension)

Records manual-testing journeys — screenshots, clicks, API calls (full bodies
via CDP), console errors, rrweb DOM stream, quick notes — into vitrinka as a
live session that projects onto a journey board with the tab-lanes timeline
sidebar. Decisions: `docs/specs/2026-07-24-journey-recorder-decisions.md`.

## Install (dev)

1. `chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/`.
2. Open the extension's **Settings** (or right-click the icon → Options): set
   the vitrinka base URL (`https://app.vitrinka.ai`, or a local
   `http://127.0.0.1:8896`) and press **Link this browser** — vitrinka shows
   a code, you approve it in a signed-in tab (or scan the QR with a phone),
   and the browser receives an ingest-only `vkr_` recorder token pinned to
   the workspace you picked (recorder decisions 2026-09-21 D5; the same
   device-code dance as `vitrinka login` and the in-app recorders). Under
   **Advanced** a `vkp_` personal token still works for an account that
   records into several workspaces: left blank, each recording then resolves
   its workspace from the tab's host across every workspace the token's owner
   belongs to (`GET /api/v1/recorder/resolve`) — a fixit tab records into
   fixit, a voke tab into voke. A host two workspaces both claim asks you to
   pin one here.
3. In vitrinka, give the project its domain rules
   (`PUT /api/v1/projects/{project}/settings`), e.g.
   `{"domains":[{"pattern":"*.fixit.dev.lovinka.com","environment":"development"}]}` —
   the popup shows which project/environment the current tab resolves to.

Loading `apps/extension/` straight from the checkout is the dev flow; testers
install the released folder via `vitrinka setup extension setup` (see `INSTALL.md`).

## Updates (how the popup can install one)

An unpacked extension never auto-updates, but Chrome re-reads the whole folder
on `chrome.runtime.reload()` — so an update is "swap the files, then reload".
The extension cannot write its own folder, so the `vitrinka` CLI does it, reached
over a native-messaging host (`in.vitrinka.updater` → `vitrinka setup extension host`,
4-byte-length + JSON frames on stdio). Three commands: `config` hands the
extension this machine's base URL, workspace and token, `check` compares the
folder on disk against the marketplace, `update` downloads + checksum-verifies
+ swaps.

Two things to know before touching any of it:

- **`manifest.json` pins `key`.** An unpacked extension's id is otherwise a hash
  of its install path, and the host manifest's `allowed_origins` must name one
  fixed id — so the key is what makes the pair line up on every machine. It is
  a public key; nothing there is secret. Changing it changes the id, which
  orphans every installed copy's `chrome.storage.local`.
  `TestExtHostManifestAndShim` asserts the host manifest still names
  `lidjccailicbgjdfaplpgmbmmecehlfo`, and `TestExtShimNamesALiveCommand`
  asserts the shim execs a command the CLI actually resolves — a shim naming a
  moved command dies before reading its first frame, which the popup reports
  only as "Native host has exited".
- **`version.js` is shared** by the worker and the popup so both answer "is
  there an update?" identically; the CLI's `compareVersions` is pinned against
  it by the same test. Anything added to the folder must also be listed in
  `dist.sh`, or the release ships an extension that dies on first import —
  `TestDistShipsEverySourceFile` fails the build instead of letting that ship.
- **`wire.js` is the ONE place a request's credentials are built.** A `vkp_`
  token acts in every workspace its owner belongs to, so the base URL alone is
  not an address: `X-Vitrinka-Workspace` names the tenant and the server
  answers `401 workspace_required` without it. A browser WebSocket carries
  neither header, so the pair socket gets BOTH stamped by the session
  declarativeNetRequest rule — add a header to one path and you must add it to
  the other. The workspace a call names is the LIVE SESSION's (`rec.workspace`,
  pinned at start from the host lookup or the options page) over the options
  page's global default — `activeWorkspace()` in `background.js` is the one
  reading; never read `workspace` straight from config on a session path.
- **The composer sheet is an extension-origin iframe (`hud.html` + `hud.js`),
  never markup in the page's shadow root.** A page's focus trap (Radix
  FocusScope, Headless UI) pulls focus back the moment it leaves the dialog
  for another element of the same document; it stands down only when focus
  moves to another document (`relatedTarget === null`). Typing into a
  shadow-root textarea under a modal went to the modal (2026-09-21). The
  content script owns placement and open/close over `postMessage`; the frame
  owns the words, the draft and the board|task pick. The HUD host is a
  `popover="manual"` element (top layer, above every page `z-index` and a
  native modal `<dialog>`), re-raised whenever a `dialog[open]` appears.

Without the host (no CLI on the machine) every path above degrades to the old
manual banner — download, unzip over the folder, ↻.

## Use

- **Start** from the popup on any tab whose host matches a project rule. Other
  tabs on the same project's domains join the session automatically (multi-tab
  journeys: admin + web side by side).
- The **corner HUD** shows rec · timer · a sync icon · pause · a pencil (note) · a crosshair
  annotate; hover the pill for the keycaps. Shortcuts: `Alt+Shift+A` annotate (click an element OR drag any
  region, note, Enter sends, ⇧Enter newline, Esc / ✕ / click outside cancels), `Alt+Shift+N` note, `Alt+Shift+P` pause.
- **The sync icon is the health answer** (recorder-live D4/D5): a check once the server
  confirms it holds everything captured, a loader while a backlog drains, a warning when
  vitrinka is unreachable, a circle-x when the session was closed or deleted
  server-side. Only trouble unfolds a second line; the popup carries the full
  picture (queued items, bytes on disk, last sync, server-confirmed seq).
- **Crosshair annotations become real board annotations** on the exact frame you
  snapped — open, assigned to claude, dispatchable through the normal
  annotation work wire.
- **A snap picks its destination before it is sent**: the popover's `board` /
  `task` pair decides whether the observation stays an annotation or is ALSO
  filed as an intake draft on the project, carrying refs back to the board and
  the session. Picking is composing — only ↑ Send commits, and the choice
  resets to `board` on every snap. A draft is never auto-accepted; triage is a
  reviewer's call.
- **Continue a journey**: the popup lists the project's recent finished
  sessions — Continue reopens one, the event stream resumes from its last
  sequence, and stop appends the new steps to the SAME set + board.
- **The board is live** (D10): a recording session is projected as you work, so
  it is there to open mid-test — screenshots wired by your clicks, notes and
  failed requests folded into shot meta, the timeline inspector (filters ·
  search · per-step network detail) on the left.
- **Stop** closes the session, showing the real upload drain rather than a
  frozen button; closing the popup is safe, the worker finishes either way.
  Reaching the board is a **separate act** (D3): the popup grows an
  `⧉ Open board` row and a notification fires when the server has finished
  building it. Stopping never hijacks a tab.

## What gets captured

| what | how | notes |
|------|-----|-------|
| screenshots | `captureVisibleTab` on click/nav/snap, throttled | active tab only; background tabs catch up on tab-switch |
| clicks | content script (capture phase) | selector, text, element rect in image px |
| navigation | `webNavigation` (full + SPA history) | no page-world patching needed |
| network | `chrome.debugger` CDP, XHR/fetch/document + worker/SW targets | req+resp bodies capped 64 KiB, headers capped 8 KiB/side; WS connections logged (frames NOT captured yet); degrades gracefully when DevTools holds the tab |
| DOM stream | rrweb (vendored record bundle, `collectFonts` on, `inlineImages` off) | uploaded as chunks; failed uploads retry from a disk-backed queue; watched via the board's session Watch mode (scrub replay); images stay hotlinked — inlining makes rrweb re-fetch the live page's images in CORS mode and breaks presigned ones (pinned by `TestRecorderNeverInlinesImages`). The trade: sessions from 0.7.0 on replay an image only while its URL still resolves, so a presigned photo renders blank once its signature expires (FixIt: 1 h); pre-0.7.0 sessions carry their images inlined |
| console errors | CDP `Runtime` (page world, incl. uncaught exceptions) | |
| notes / snaps | HUD | crosshair = element pick OR region drag + note + forced screenshot → board annotation, and an intake draft too when the tester picks `task` |

Capture-everything is deliberate (D7), bounded by the workspace redaction
policy the worker fetches at session start (`GET /api/v1/recorder/policy`,
fail-closed `maskAllInputs`) — the policy, not the network, is what keeps a
recording safe to take.

## Known limits

- `chrome.debugger` shows Chrome's "is debugging this browser" banner while
  recording (the D2 tradeoff) and cannot attach while DevTools is open on the
  same tab — recording continues without network capture.
- The capture queue is **IndexedDB** (`db.js`) and the small hot state
  (config, session) is `chrome.storage.local` — SW restarts AND full browser
  restarts keep the undelivered tail, which drains on the next launch. Only
  requests mid-flight across a SW restart lose their response body.
- **Nothing is ever dropped to make room** (D8): the queue grows for as long as
  vitrinka is unreachable and the HUD turns loud instead. Space is reclaimed by
  reaping sessions the SERVER reports as done/deleted/gone — a live recording
  is never touched — and Settings shows per-session usage with a manual clear.
- `vendor/rrweb-record.min.js` is `@rrweb/record@2.1.1` (`dist/record.umd.min.cjs`),
  vendored verbatim. UMD global is the module object (`rrwebRecord.record`);
  content.js adapts to both shapes. The version pins the server's replay bundle
  `internal/web/static/vendor/rrweb-replay-2.js` — bump them together, and bump
  the replay bundle's `-N` suffix when you do: `/vendor` is immutable-cached for
  a year, so replacing its bytes under the same name strands every returning
  viewer on the old replayer (see the vendor README's `-1` → `-2` note).
