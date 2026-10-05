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

### Devbox verification

The root `devbox.yaml` runs `apps/extension/e2e/fixture.ts` on the kit app's
`web` port: a synthetic form and recorder API, not a source-directory server.
Use the current address from `devbox url` for both the page and the recorder
base URL, with workspace `qa` and a dummy token — never production credentials.
The fixture keeps recordings in memory; `/__qa/state` exposes captured events
and chunks, and `POST /__qa/mode` with `{"mode":"strict"}` or
`{"mode":"failed"}` exercises text masking or policy failure (`default`
restores the default policy). A packaged store archive is available only at
`/__qa/store.zip`; unknown paths return 404.

`devbox run --no-up test` runs the build, typecheck and unit gates without
starting the fixture. Extension packaging (`apps/extension/dist.sh`) needs
`zip` and `unzip`, declared under `system_packages.apt` in the recipe. A guest
missing those tools needs the Devbox-reported provisioning fix, not a raw
package installation. Browser verification additionally needs a Chrome
session that permits this extension; an installation acknowledgement alone
is not evidence that its service worker or capture ran.

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
- **The HUD is `@vitrinka/web`'s, never drawn here.** `vendor/vitrinka-hud.iife.js`
  is the package's `build/hud.iife.js` (`globalThis.VitrinkaHud.mount`),
  pinned in `vendor/vitrinka-hud.pin.json` and written only by
  `go run ./tools/vendor-hud` (bump: edit the pin's `version`, run it, commit
  both; `-check` in CI, `TestVendoredHudMatchesPin` offline). `content.js`
  supplies its `HudController` — a thin adapter over the worker's messages
  (`vt-status`/`vt-paused`/`vt-health` paint the recording; `vt-hud*` carry
  the account, prefs and recents `background.js` keeps in
  `chrome.storage.local`). The HUD's sheet portals into the topmost open
  dialog itself, so a page's focus trap or a native modal never steals the
  textarea. A pill or sheet change ships from the kit, then a pin bump here.
  The pair panel is the one surface the HUD has no seat for: it keeps its own
  small shadow host in `content.js`, just inside the HUD's spot.
- **A session id is a number per base AND workspace.** The options page can
  switch either, and `#12` exists on two servers and in two workspaces of
  one, so whatever outlives the live recording names its scope beside the id:
  a recent is `(base, workspace, sessionId)` and the HUD lists only the
  current scope's; the board wait (`awaiting.scope`) and a queued tail
  (`queueScope:<id>`) are asked only of their own base, in their own
  workspace (`api(…, { base })` refuses a read whose base moved). Never match
  a stored session by id alone, and never send the token to an entry's base
  unless it is the configured one. Recents from before 0.9.1 named no base
  and are dropped. The IndexedDB queue itself is still keyed
  `[sessionId, seq]`, so Start/Continue refuse an id whose other-scope tail
  is still queued (`refuseForeignTail`) rather than mix the two.
- **Stored read-modify-writes run on a `serialized()` chain** (`withLock` for
  `rec`, `withRecents`, `withPrefs`): every `chrome.storage.local`
  get→await→set that two messages can reach at once needs one, or the
  slower writer restores what the other just changed. A decision two state
  reads feed belongs under the lock their writers share: a `queueScope`
  marker is written with its `rec` and pruned under `withLock`. A request
  checked against a credential is sent with that same settings read
  (`api(…, { cred })`), since Settings relinks by writing storage directly.

Without the host (no CLI on the machine) every path above degrades to the old
manual banner — download, unzip over the folder, ↻.

## Use

- **Start** from the popup on any tab whose host matches a project rule. Other
  tabs on the same project's domains join the session automatically (multi-tab
  journeys: admin + web side by side).
- The **HUD** is the same pill the in-app recorder shows (`@vitrinka/web` 0.3.3):
  rec dot · timer · sync chip · pause · note · annotate · ■ stop · ⋯, at one of
  eight spots or tucked into an edge. Shortcuts: `Alt+Shift+A` annotate (click
  an element OR drag any region, note, Enter sends, ⇧Enter newline, Esc / ✕ /
  click outside cancels), `Alt+Shift+N` note, `Alt+Shift+P` pause,
  `Alt+Shift+S` stop. The ⋯ menu names the account (`GET /api/v1/recorder/me`,
  `vkr_` tokens only, 8 s cap; a `vkp_`/`vks_` token reads `API token ·
  <workspace>`, a failed read the cached account or `Linked device`), lists this
  browser's last five recordings on the current server and workspace with
  their boards, and sets the size and the technical details (user prefs; on the
  device for a key build, a non-recorder token or a server without the route;
  edits apply in order, one PATCH at a time).
- **The sync chip is the health answer** (recorder-live D4/D5): `synced` once the server
  confirms it holds everything captured, `sending N` while a backlog drains,
  `offline · N` when vitrinka is unreachable, `ended` when the session was closed or deleted
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
  building it. Stopping never hijacks a tab. Stopped from the pill, the HUD
  asks first (Stop & save?), then says **Saving…** and **Saved · in Recents**
  while the server builds the board (30–60 s), turning into **Saved · Open
  board** with the server's link once the worker's board wait (D11) names it;
  offline, it keeps the session and offers Retry.
  Dismissed, it rests as a Start button on that tab until the page goes.

## What gets captured

| what | how | notes |
|------|-----|-------|
| screenshots | `captureVisibleTab` on click/nav/snap, throttled | active tab only; background tabs catch up on tab-switch |
| clicks | content script (capture phase) | selector, text, element rect in image px |
| navigation | `webNavigation` (full + SPA history) | no page-world patching needed |
| network | `chrome.debugger` CDP, XHR/fetch/document + worker/SW targets | req+resp bodies redacted BEFORE the 64 KiB cap, headers capped 8 KiB/side with auth values scrubbed; oversized multipart bodies omitted; WS connections logged (frames NOT captured yet); degrades gracefully when DevTools holds the tab |
| DOM stream | rrweb (vendored record bundle, `collectFonts` on, `inlineImages` off, the recorder's own `[data-vitrinka-recorder]` surfaces blocked) | input values masked by default; uploaded as chunks; failed uploads retry from a disk-backed queue; watched via the board's session Watch mode (scrub replay); images stay hotlinked — inlining makes rrweb re-fetch the live page's images in CORS mode and breaks presigned ones (pinned by `TestRecorderNeverInlinesImages`). The trade: sessions from 0.7.0 on replay an image only while its URL still resolves, so a presigned photo renders blank once its signature expires (FixIt: 1 h); pre-0.7.0 sessions carry their images inlined |
| console errors | CDP `Runtime` (page world, incl. uncaught exceptions) | |
| notes / snaps | HUD | crosshair = element pick OR region drag + note + forced screenshot → board annotation, and an intake draft too when the tester picks `task` |

Capture is **redacted by default** via the shared
[`@vitrinka/redact`](../../packages/redact) engine (`vendor/redact.js`, a
generated copy CI keeps in sync): auth-bearing header values, sensitive
JSON/form/multipart body keys, URL query/fragment secrets, and console text
are scrubbed before storage, and rrweb records with input values masked.
Click labels respect that masking and `.rr-mask` / `.rr-block` regions.
At session start the extension fetches your workspace's redaction policy
(`GET /api/v1/recorder/policy`), which can add extra rules or `maskAllText`.
Until the policy settles, all DOM text is masked and screenshots wait or
are dropped; transient failures keep this strict mode and retry. A confirmed
absent policy uses the built-in defaults — never capture-everything.
Self-hosted deployments can opt back into full-fidelity capture server-side.
Under `maskAllText`, screenshots are reduced to 96px wide (layout visible,
text unreadable); a frame that cannot be downscaled is dropped, never stored
raw. The vitrinka server re-applies the same redaction at ingest as a backstop.
Even so: record only against environments you own.

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
