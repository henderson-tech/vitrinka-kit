# What the recorders capture, and where it goes

This document is a user-facing contract. Any change to what a recorder
captures or transmits must update it in the same PR (enforced by review; see
`CONTRIBUTING.md`), and divergence between this document and the code is
treated as a security issue.

## Where data goes

Exclusively to **the vitrinka server you configure** (base URL + bearer
token). There is no third-party telemetry, no analytics SDK, and no traffic to
any host other than that server. The wire types live in
[`packages/expo/src/protocol`](../packages/expo/src/protocol/index.ts)
(mirrored byte-compatibly in
[`packages/web/src/protocol`](../packages/web/src/protocol/index.ts), and in
Swift in [`packages/macos`](../packages/macos/Sources/VitrinkaRecorderCore/Wire.swift))
and ride these routes:

```
GET   /api/v1/recorder/policy      workspace redaction policy + the attachments switch (session start; the web pill's flight recorder)
GET   /api/v1/recorder/me          who the token is + HUD prefs (web HUD)
PATCH /api/v1/recorder/me          HUD prefs {size, verbose} or {sheetW, sheetH} (web HUD, linked devices)
POST  /api/v1/sessions             create a recording session
POST  /api/v1/sessions/:id/events  the event stream (batched)
POST  /api/v1/sessions/:id/shot    screenshot keyframes (Expo, extension, macOS); images a tester attached (below)
POST  /api/v1/sessions/:id/chunk   rrweb DOM-stream chunks (extension, web)
GET   /api/v1/sessions/:id         reconcile: what the server holds
PATCH /api/v1/sessions/:id         status (recording | paused | done)
```

Both recorders authenticate with an **ingest-only recorder token** (`vkr_…`:
project-pinned, valid only on the routes above) — minted by the device link
(`POST {origin}/api/v1/cli/auth {kind:"recorder", label}` → code;
`POST {origin}/api/v1/cli/auth/claim {device_code}` polled until approved;
a `…/w/<slug>` target adds `workspace=<slug>` to the approve link so the
right workspace is preselected, and refuses a token approved into another;
see [`packages/link`](../packages/link)) or, for unattended builds, an
admin-minted recorder key baked into the build. The packages never inspect
the token, they only send it as the bearer — the web recorder with
`credentials: omit` so no cookie ever rides along. A 401 forgets a linked
token.

The **macOS recorder** (`packages/macos`, the Swift package
`VitrinkaRecorder`) uses the same token kinds: `VITRINKA_RECORDER_TOKEN` in
the process environment, else the user default `VitrinkaRecorderToken`,
else a device link made from its HUD (stored in `link.json`, mode 0600). It
sends no `Origin` header and no cookie, and its User-Agent is
`VitrinkaRecorder/<version> (vitrinka-macos-live/1)`.

**Report a problem** (the report face of `@vitrinka/web`, also served by
vitrinka as `/vendor/report-widget-1.mjs`) speaks only the report leaves,
with the project's publishable report key (`vkb_…`) as the bearer, also with
`credentials: omit`:

```
GET   /api/v1/report-config             → {project, captureProfile (+ its attachments caps), portalUrl, profile, flightRecorder}
POST  /api/v1/reports                   the report (below) → {id, custody: "direct" | "quarantined", memberError?}
PATCH /api/v1/reports/:id               {title, description, markers, notify} — text changed before a retry
POST  /api/v1/reports/:id/attachment?name=<file name>  one file the reporter attached, its raw bytes under its own Content-Type → {id, name, size, type}
POST  /api/v1/reports/:id/chunk?seq=N   one rrweb chunk (a JSON array, ≤ 4 MiB, N from 1) → {blobKey}
POST  /api/v1/reports/:id/events        {events: [{seq, ts, tabHost, kind: "rrweb", payload: {count, source: "replay", truncated}, blobKey}]}
POST  /api/v1/reports/:id/submit        {} → {status: "filed" | "quarantined", reportUrl?} — the last leg
POST  /api/v1/report/session            {token, memberToken?} → {reporter, session, expiresAt, portalUrl?, memberError?} — My reports, a signed reporter only
GET   /api/v1/report/mine?cursor=       X-Vitrinka-Reporter: <session> → {reports, nextCursor} — that reporter's own reports
```

A browser that holds a vitrinka member's device link minted on the widget's
own `base` (`vitrinka.recorder.link`, below) also reads `GET
/api/v1/recorder/me` with that link's own `vkr_` token, never the `vkb_` key:
who the member is and their display mode. The same token rides in the body
of the report and of the reporter session (`memberToken`, web 0.9.2), the
`vkb_` key still the bearer, so the member co-owns what they report and
finds it in My reports. A link minted on another vitrinka is never sent,
nor a `vkr_` key the host's build passes. Its **Record** (npm entry only) swaps the card for the
recorder pill, which then records as the web recorder does, on that link.

Its single-file build loads one more thing, and only when the project's
profile records the page: rrweb's recorder, from the same vitrinka
(`<base>/vendor/rrweb-record-1.min.js`). The npm build imports `rrweb`
(the peer dependency) lazily instead.

## When recording happens

Only during a session you explicitly start:

- **Expo recorder**: recording exists only in builds that bake
  `EXPO_PUBLIC_VITRINKA_URL`; every other build strips the whole recorder
  from the bundle at compile time. No secret is baked: the tester **links the
  device** from the pill (a short code approved in vitrinka — the
  `@vitrinka/link` flow), which mints an ingest-only `vkr_` token the
  recorder stores on-device (`vitrinka.recorder.link`); "Unlink" or a 401
  forgets it. Unattended builds may bake `EXPO_PUBLIC_VITRINKA_TOKEN` holding
  an admin-minted `vkr_` recorder key — never a workspace token. Within an
  enabled build, capture runs only between you pressing record and stop (or
  a machine-driven session started over the Expo devtools channel, shown by
  a visible HUD indicator).
- **Browser extension**: capture runs only in tabs matching the project's
  configured domains, only while a session you started is live. The popup
  always shows the recording state.
- **Web recorder** (`@vitrinka/web`, mounted in the app itself): the recorder
  is inert unless `url` is present (a prop, or `NEXT_PUBLIC_VITRINKA_URL`) —
  without it the root renders its children and starts nothing. No secret is
  baked: the tester **links the device** from the pill (a short code, an
  "Open vitrinka" link for the same device, a server-rendered QR for another
  device), which mints an ingest-only `vkr_` token stored in `localStorage`
  under `vitrinka.recorder.link`; "Unlink" or a 401 forgets it. A
  `recorderKey` prop (`NEXT_PUBLIC_VITRINKA_KEY`, an admin-minted `vkr_`
  key) is for CI and unattended builds only, and `withVitrinkaRecorder`
  refuses a production build carrying such a baked key outside an allowed
  lane. Within an enabled build, capture runs only between you starting a
  recording from the pill (or the `window.__vitrinkaRecorder` control
  handle) and stopping it; the pill is always visible while recording. A
  recording survives a reload of the same tab and continues in it; another
  tab of the app opened during it joins it, and a Stop in any tab ends
  capture in all of them. The one
  exception is the **flight recorder** behind "Report a bug" (below): while
  the pill is mounted and idle on a device that can record (a key or a
  link), it keeps the page's last minute **in memory only** — nothing is
  written to storage and nothing is sent until you press Send on a report;
  a reload discards it. The host turns it off with `flightRecorder: false`.
- **macOS recorder** (`VitrinkaRecorder`, Swift): the live code exists only
  in Debug builds; a Release build compiles the API to empty stubs, and
  `packages/macos/scripts/check-release-binary.sh` fails a binary that still
  contains it. In a Debug build it is inert unless `VITRINKA_RECORDER_URL`
  (or the user default `VitrinkaRecorderURL`) names a server. Capture runs
  only between the tester pressing Record in the HUD (or the host calling
  `start()`) and Stop; the HUD is visible the whole time. A recording that
  a relaunch interrupted comes back paused and records nothing until resumed.
- **Report a problem** (the report face, `mountReport` / `<vitrinka-report>`):
  while the widget is mounted it keeps the last minutes of the page under
  the **project's capture profile** (below) — in memory, or in this
  browser's IndexedDB when the profile says `storage: browser` — and sends
  nothing until the person presses Send on a report. Nothing is captured
  before the profile is read; a host can only narrow it.

## What is captured (per session)

| Channel | Expo recorder | Browser extension | Web recorder | macOS recorder |
|---|---|---|---|---|
| Screenshots | keyframes on navigation/touch (throttled) | keyframes + rrweb DOM stream | **none** — the rrweb DOM stream is the keyframe (input values always masked, all text under `maskAllText`; images recorded by URL, never inlined) | JPEG keyframes of the app's own window (with its attached sheet), never of other apps: on start, on a window, sheet or route change, 120 ms after a click (throttled to one per 700 ms), on a mark and for an annotation; private views painted black (below) |
| Interactions | tap coordinates + pressed-element label + route | clicks, navigation | clicks (short selector, element text — never a form field's value, see Redaction — rect), navigation (pushState/replaceState/popstate or the router's pathname) | clicks (position and element rect in keyframe pixels, the control's accessibility label or title or a list row's text, `role#identifier` as the selector — never a field's value, no name inside a private view — and route); window lanes and routes as `nav`. While recording, the app's own accessibility tree is turned on (`AXEnhancedUserInterface` on the app, restored at Stop; the host can turn this off) so SwiftUI controls have names |
| Keys | — | — | — (typing exists only as rrweb's masked input events) | `key {combo, target, route}` for ⌘/⌃ shortcuts and Return, Escape, Tab, arrows, Delete only; typed characters never; nothing while a secure field has focus |
| Network | method, URL, status, duration, capped request/response headers + bodies (redacted) | API calls incl. headers + bodies (via CDP) | fetch + XHR: method, URL, status, duration, capped request/response headers + bodies (redacted); never the recorder's own uploads | none |
| Console | errors/warnings | errors | `console.error`, uncaught errors, unhandled rejections | unified-log error and fault entries of the app's own subsystems (its bundle id and app id; `Logger.warning` writes at error level, so the host's warnings count), plus subsystems and `NSLog` text prefixes the host names; never framework lines without a subsystem, never the recorder's `dev.vitrinka.recorder`; a line repeated within 60 s is sent once plus one `repeats: N` summary; at most 200 per session, then one `capped` entry; 8 KiB each |
| Notes | notes you type in the HUD | notes you type in the popup | notes and element/region annotations you type in the HUD, and images you attach to them (below) | notes and region annotations you type in the HUD (no attachments yet) |

Every web session's create carries `meta.recorder` (`web/<version>`),
`meta.platform` (`web`), `meta.userAgent`, `meta.appVersion` when the host
passes one, and `meta.devicePixelRatio` — the scale every recorded rect is
in, so the server renders its stills at it.

Every macOS session's create carries `app` (the host's app id, the bundle id
by default), `title` (by default "<app name> · <local date and time>"), and `meta.recorder` (`macos/<version>`),
`meta.platform` (`macos`), `meta.appVersion`, `meta.osVersion`,
`meta.devicePixelRatio` (the main screen's backing scale) and
`meta.driver` (`human`). Each top-level window is one lane (`tabId`, e.g.
`main`, `settings`); `tabHost` is `/<lane>/<route>`. A keyframe's bytes go
to `/shot?seq=N` first and its `shot` event (payload `{route, title,
reason, w, h, scale}`) carries the returned `blobKey`. Click rects and
annotation rects are in that keyframe's pixels. A mark is a keyframe
followed by a plain note on it; an annotation is a note
`{text, rect, annotate: true, route}` followed by the frame taken before the
marquee appeared, 1 ms later. Stop sends `PATCH {status: "done"}` and then
reads `GET /api/v1/sessions/:id` until the board is built.

### Bug reports (web recorder)

"Report a bug" in the pill's ⋯ menu files what led up to a bug without a
recording running:

- **What the idle pill keeps** (the flight recorder): the rrweb DOM stream as
  checkout windows of 30 s, each kept while it still covers part of the
  last 30 s (a clip covers the last 30–60 s and always opens on a full
  snapshot), and the click, navigation, console and network events since
  the oldest window opened — capped at 4 MiB of serialized rrweb, 20 000
  rrweb events and 500 lane events. Over a cap the oldest window goes; when
  only the window being recorded is left over it, a fresh full snapshot is
  taken and the old window goes (incremental events are never spliced out).
  It is captured under exactly the redaction a recording uses
  (masked inputs, the workspace policy — fetched once when the buffer
  starts — scrubbed URLs, click text that never reads a value), held in
  memory, never persisted, and discarded on reload, unlink or when a
  recording starts. The clip is frozen when the report sheet opens; if it
  then holds no window that opens on a full snapshot (a window over a cap
  was dropped and the next checkout has not come yet), a fresh checkout is
  taken first, so a report always carries at least the current screen.
- **What a report sends**, only on Send, under the pill's own credential:
  1. `POST /api/v1/sessions` — `title: "Bug report: <first line>"`,
     `meta.kind: "report"`, `meta.devicePixelRatio`, and the same `host`,
     `project` and `environment` as a recording;
  2. the buffered events with their **original** timestamps (seq 1…n), led
     by a `nav` to the page the first snapshot shows;
  3. the rrweb windows as chunks (`/chunk?seq=N`, then their `rrweb` rows);
  4. the images attached to the report, if any (`/shot?seq=N`, then their
     `attachment` rows — see Attached images);
  5. the description as a note `{text, rect, selector, annotate: true, task:
     true, route}` (+ `attachments`) stamped at Send — `rect` is the region
     marked on screen (device pixels), else the whole viewport;
  6. `PATCH /api/v1/sessions/:id {status: "done"}`.
- **During a recording**, Report adds that task annotation to the running
  session instead; no second session, no clip.

### Report a problem (web report face)

The same capture engine as the recorder (the rrweb lane, the console and
network lanes, the flight buffer, the redaction engine), with a reporter's
face: a "Report a problem" button, a card that asks what went wrong, and
optional marks drawn on the page.

- **The capture profile** comes from `GET /api/v1/report-config`
  (`captureProfile`); the host's `capture` option can only narrow it
  (storage only down to memory, a shorter window, a lower cap, fewer
  classes). A server without one, or an unreachable one, means memory, the
  last 60 s, 4 MiB, errors + the replay, strictly masked.

  | Field | Meaning |
  |---|---|
  | `storage` | `browser` (the server's default): the windows are also written to IndexedDB (`vitrinka.capture`) so the minutes before a report survive the page loads in between; or `memory`. Memory is only the widget's fallback when the server sends no profile (or no valid `storage`) |
  | `windowSec` | how far back (default 300): a checkout window is kept while it still covers part of it |
  | `maxBytes` | the replay's cap (default 12 MiB); over it the oldest window goes, and when only the window being recorded is left a fresh full snapshot is taken — the replay is then marked `truncated` |
  | `classes` | `interactions` — the masked rrweb replay (clicks, scrolls, typing as masked input, each page's view); `errors` — uncaught errors, unhandled rejections, `console.error`, failed requests; `console` — every console level; `network` — every request; `full` — all four |

- **Masking** follows the project's `profile`: `strict` (default) masks every
  input value and every text node — a subtree the host marks
  `data-vitrinka-unmask` keeps its text, never its input values;
  `balanced` masks input values; `full` masks nothing. Page URLs (the
  replay's, the report's `env.url`) pass the redaction engine's query and
  fragment scrub and the host's `sanitizeUrl`; `env.url` never carries a
  query. Console text is redacted like a recording's and capped at 2 000
  characters. Requests are metadata only — method, path (pathname only,
  token-shaped runs replaced by `•••`), status, duration — never a header or
  a body, and never the widget's own calls.
- **Browser storage.** Masking happens before storage: what IndexedDB holds
  is exactly what would be sent. Every window's new events land there every
  2 s (and on pagehide) as one chunk; the console and network entries go to
  spans of their own (each covering at most the window), so an errors-only
  profile keeps them across loads too. A window or span leaves storage when it leaves the window,
  every window of a tab once that tab's report is sent, and anything past
  its age on the next load of any tab. Each window records what it was
  captured for — vitrinka's origin, the project, the masking profile and the
  classes — and a load under anything else (another project in the same
  tab, a stricter masking, fewer classes) drops this tab's windows instead
  of restoring them. A report sends only its own tab's windows. A profile of
  `memory` deletes the database. What the reporter types — the description,
  notes — and the files they attach are memory only, with one exception: a
  sent report leaves a line in this browser's own list
  (`vitrinka.report.sent:<base>|<host>` in localStorage, the last 20) — its
  title (the description's first line), when, filed or waiting for
  approval, and its link when the server returned one — which My reports
  shows when the server cannot list the reporter's reports.
- **An idle page** keeps no more than the window: once the newest event of
  the window being recorded is older than `windowSec`, a fresh full snapshot
  replaces it (rrweb itself checks out only when the page changes).
- **When the card opens**, the capture is frozen (the buffer keeps rolling);
  with no full snapshot of the current page yet, one is taken first, and
  the windows earlier loads stored are read right then, so a draft that
  takes its time still sends them.
- **Beside the recorder.** The console and network patches, the buffer, the
  rrweb lane and the redaction rules are page-wide, and the recorder face
  runs them whenever it is mounted: a report face beside it captures
  nothing (its reports go without a capture), and one already capturing
  stops when a recorder mounts — across bundles too (the standalone widget
  beside a host's npm recorder). The report face never changes the
  recorder's server, key or rules.
- **Marks.** "Show us where" freezes the page under a transparent layer
  (no clicks, no scrolling reach it) where the reporter draws circles,
  boxes, arrows and hides, numbered 1, 2, 3… with an optional note each —
  with the pointer, or from the keyboard (Enter places a mark, arrows move
  it, Shift+arrows resize it, Enter again sets it).
  There is no element selector: a mark is a viewport rectangle in CSS
  pixels, and the report's `env.viewport` says `{w, h, dpr}`. An arrow also
  says which corner its head points into (`head`: `nw` · `ne` · `sw` ·
  `se`). A **hide** blanks its region in the capture before it leaves the
  browser: an opaque box joins every full snapshot of the replay (so every
  frame and every still shows it blank), and the text and form values of
  the page's nodes centred under it — named when the hide is drawn, while
  the page sits frozen, and again at Send — are emptied in the snapshots,
  in later mutations and in input events. Where the page recorder cannot
  name those nodes (a build without rrweb's mirror), a report with a hide
  goes without its replay.
- **What a report sends**, only on Send, under the widget's own `vkb_` key
  to its own `base` (two widgets on one page never send through each
  other):
  1. `POST /api/v1/reports` — `{title (the description's first line, ≤ 100
     characters), description, env: {url, ua, viewport: {w, h, dpr},
     appVersion, locale (the browser's)}, console: [{level, ts, text}],
     network: [{method, path, status, ms}], identity?, markers: [{n, shape,
     rect: {x, y, w, h}, note?, head?}], locale (the widget's: cs | en),
     notify?, type?, memberToken?}` — at most 500 console and 500 network
     entries; `type` is the reporter's own word (`bug` · `suggestion` ·
     `question` · `other`), sent only when one is picked; `memberToken` is
     the browser's member link for this `base` (above), sent only when it
     holds one. A server that refuses either field by name gets the report
     again without it; a `memberError` in the answer (the link revoked,
     another workspace's, its person no longer a member) still files the
     report, and a revoked link, or one whose person left, is forgotten;
  2. the files the reporter attached, one `/attachment?name=` leg each —
     only files picked with 📎, pasted or dropped onto the card, each
     checked first against the project's caps (by default 10 MiB per file,
     5 per report, images, PDF and text); a file is never read or sent
     otherwise;
  3. the frozen replay, hides applied, as chunks under 4 MiB
     (`/chunk?seq=1…n`), then their `rrweb` rows (`/events`, `payload:
     {count, source: "replay", truncated}`) — a window holding a single
     event over 4 MiB (a huge full snapshot) is left out whole, never its
     snapshot alone, and the replay says `truncated`;
  4. `POST /api/v1/reports/:id/submit {}`.

  A failed leg keeps the job: Retry resumes it — one report, never a
  duplicate — and text edited meanwhile rides a `PATCH`; Try again sends
  only the files that did not land, and a file the server refuses for good
  is left out while the report still files. A capture leg the
  server refuses for good is skipped, and the report files without its
  replay. `reportUrl`, when the server returns one, is shown as returned
  ("See your report"); the widget never composes a link.
- **Identity** is the host's word, held in memory for the page's life:
  `identify({token})` passes a compact HS256 JWS the host's SERVER signed
  with the project's host secret over `{sub, email, name?, iat, exp, aud:
  "<workspace>/<project>"}` (`exp` ≤ 24 h after `iat`) — a valid one files
  the report directly; `identify({email, name?})` binds it to a pending
  reporter (quarantined until approved); nothing at all is anonymous and
  quarantined. The widget never reads the token's claims. `notify` ("Email
  me when it's fixed") is offered only to an identified reporter.
- **My reports** for a signed reporter: the widget trades the host's token
  once for a short-lived reporter session (`POST /api/v1/report/session`),
  held in memory and dropped when the host identifies someone else, and
  lists that reporter's reports with it (`GET /api/v1/report/mine`); the
  `vkb_` key alone reads nothing. A browser holding a member link for the
  `base` proves it in the same trade (`memberToken`), and the list is the
  reporter's reports and the member's; linking, unlinking or relinking
  drops the session and opens a new one. Anyone else gets this browser's
  own list (above).
- **On the device**: the reporter's shortcut, when they record one, in
  `localStorage` (`vitrinka.recorder.report.keybind`: the key's code and its
  modifiers); the widget's settings, per origin, in `localStorage` — the
  button's corner (`vitrinka.report.dock`), its size
  (`vitrinka.report.size`), and for a linked member the picked face
  (`vitrinka.report.face`) and display mode (`vitrinka.report.mode`); the
  list of reports this browser sent (above); the tab id in
  `sessionStorage` (`vitrinka.tab`); and, under `storage: browser`, the
  capture database above. Nothing else.

### Attached images (web HUD)

A tester can attach reference images ("how it should be") to a note, an
element/region annotation or a bug report: pasted into the sheet, dropped
onto it, or picked with its paperclip. Only images the tester deliberately
attaches are sent; nothing is picked up on its own.

- **Only where the server allows it.** The HUD offers attachments only when
  the policy read answers `attachments: true`
  (`GET /api/v1/recorder/policy` → `{policy, fullFidelityAllowed,
  attachments}`): the field is absent on servers before attachments and
  `false` when the workspace switched them off (`noAttachments`). The web
  recorder never uploads an image that read did not allow.
- **Re-encoded on the device first.** Each image is decoded and re-encoded
  in the browser before anything is stored or sent — WebP at quality 0.85,
  JPEG where the browser cannot write WebP, PNG when JPEG would lose its
  transparency — so its EXIF and GPS metadata never leave the device. The
  long edge is at most 2560 px and the file at most 12 MiB (it is scaled down
  until it fits); an animated image keeps its first frame; a file that is not
  an image is refused in the sheet. At most 4 images per note.
- **What is sent**, per image: its bytes through
  `POST /api/v1/sessions/:id/shot?seq=N` (the image's own Content-Type),
  then an `attachment` event `{name, mime, bytes, w, h}` carrying the
  returned `blobKey`, in the note's tab lane, its seq just below the note's.
  The note lists them as `attachments: [seq, …]` and may then have empty
  text. `name` is the file's own name ("pasted image.png" for a paste).
- **Not masked.** A reference image is the tester's upload, not captured
  screen: `maskAllText` does not blur it. The workspace's lever is the
  switch above.
- **On the device**, an image waiting for its upload is kept in IndexedDB
  (database `vitrinka.recorder.blobs`) so it survives a reload, and deleted
  once the server acknowledged its event, or when its session ends.

### Note history: edits and references (web HUD 0.6)

Every note and annotation the HUD sends carries a client id, `cid` (a random
id minted in the browser; it names the note, nothing about the tester or the
page). The notes sheet lists the recording's notes from the device: the
recorder storage keeps each note's text, route, kind, region size and ids
(key `notes`) for as long as the recording lives and drops them when it ends
— a recorder token reads nothing back from the server. Two actions add fields
to a NEW note event:

- **Edit** sends the corrected note as a new `note` event with
  `replaces: <cid of the note it corrects>`. The stream stays append-only:
  the earlier event is never rewritten; the board shows the latest version
  and keeps the earlier ones in the annotation's thread.
- **Reference** adds `refs: [<cid>, …]` — the notes this one points at.

A note written while the recording is paused is queued and sent, like any
note (capture lanes stay off while paused).

## Redaction

Capture redacts secrets **before anything is buffered or sent**, driven by
the shared engine [`@vitrinka/redact`](../packages/redact) (spec + portable
conformance vectors in
[`packages/redact/spec`](../packages/redact/spec/REDACTION-SPEC.md)):

- **Headers**: auth-bearing names (`authorization`, `cookie`, `set-cookie`,
  `x-api-key`, any `…api-key`/`…token` variant, …) lose their values.
- **Bodies**: secret-named keys (`password`, `token`, `card_number`, `ssn`,
  multi-word forms like `accessToken`, …) are masked recursively in JSON,
  form-encoded and multipart bodies — including bodies truncated at the size
  cap, and URL-encoded / double-encoded forms.
- **URLs**: sensitive query AND fragment parameters are scrubbed
  (OAuth callbacks, magic links, SAS URLs), with `;`-separated pairs handled
  — in request URLs, and in the web recorder also in every navigation URL
  (the page a session starts on included) and in the page URL rrweb stamps
  on every full snapshot. The web recorder's `route` fields (navigation,
  clicks, notes, bug reports) and the Expo recorder's route (every event's
  `tabHost`, the `route` of navigations, taps and keyframes) pass the same
  scrub.
- **URL paths**: a credential in a path segment (`/reset-password/<token>`)
  is the host app's to name. The web and Expo recorders' `sanitizeUrl`
  option rewrites every URL and route they capture before the scrub above,
  under any policy (`fullFidelity` included). A sanitizer that fails records
  only the URL's origin (`[redacted]` for a bare route), never the raw value.
- **Values**: a PEM private key (`-----BEGIN … PRIVATE KEY-----`, any key
  type, encrypted or not) is scrubbed wherever it appears — a body field
  under any name, a form value, a console line — even when a size cap cut
  off its END line. Certificates and public keys stay.
- **macOS recorder**: a Swift port of the engine
  (`packages/macos/Sources/VitrinkaRecorderCore/Redaction.swift`) that
  passes the same `vectors.json` in its test suite (from a copy, with a test
  that fails when the copy drifts). It scrubs click and key labels, window
  titles, routes (after the host's `sanitizeRoute`) and console text, and
  under `maskAllText` click and key labels are empty.
- **Multipart uploads beyond the 64 KiB body cap record as an omission
  marker**, not a partial body: a truncated multipart body cannot be parsed
  into parts, and a partial scan would leak exactly the fields the key scrub
  protects — the recorders fail closed instead.

All the clients apply this engine — Expo and web import it directly, the
browser extension carries a generated copy (`vendor/redact.js`, kept in
sync by a CI drift check), and the macOS recorder carries the Swift port. The vitrinka server additionally applies the same
redaction at ingest for every client as a backstop. Web and extension feed
the engine's `maskDirectives` to rrweb: input values are masked by default and,
under `maskAllText`, all text is masked; only the explicit self-hosted
`fullFidelity` policy restores field values. Console text passes through
`redactText`. A click's text never shows more than the DOM stream does:
input, textarea and select values/text are masked by default, as is an
element at, inside or wrapping `.rr-mask` / `.rr-block`, and all labels under
`maskAllText`; remaining labels pass `redactText`. Navigation, screenshot,
vitals and rrweb Meta page URLs are scrubbed by the extension before storage.

At session start the recorder fetches your workspace's redaction policy
(`GET /api/v1/recorder/policy`; the web pill's flight recorder fetches it
before its buffer starts), which can only ADD rules: extra header
names, extra body keys, extra patterns, or `maskAllText`. If the fetch fails,
the built-in defaults above apply — **never** capture-everything. A
`fullFidelity` policy (self-hosted deployments only; the server refuses to
serve it otherwise) restores unredacted capture.

Screenshots carry real rendered pixels and are not content-filtered by
default. Under a `maskAllText` policy Expo, extension and macOS capture
keyframes at a strongly reduced resolution (text unreadable, layout visible;
the extension drops a frame it cannot downscale rather than storing it raw;
macOS keyframes are 96 px wide). The macOS recorder paints the frames of
views the host marks private (`.vitrinkaPrivate()`), and of every secure
text field, black before a keyframe is encoded, leaves windows marked
private out of every keyframe, and drops a frame when a private view on it
cannot be located. The web
recorder takes no screenshots at all. Until the extension's policy settles,
its DOM masks every input and all text, and its screenshots wait or are
dropped; transient policy failures retry without reopening capture.
Otherwise: do not record against screens showing data you would not put on
the session's board.

## The HUD itself

The web recorder's HUD is never part of a recording. Its shadow host (and a
sheet host portaled into a page dialog, and the annotate-mode stylesheet)
carries `data-vitrinka-recorder`, rrweb's `blockSelector`. rrweb 2 has no way
to omit a blocked node, so the replay keeps a placeholder of the host's size.
The host is 0×0, so that placeholder is empty. rrweb skips mouse interactions
on blocked nodes. The click lane ignores the HUD. The network lane skips the
recorder's own requests to the configured server (session doors,
`/recorder/me`, the session reads that fill the recents' and the Saved face's board link). The console lane skips the
recorder's `vitrinka:`-prefixed logs.

The HUD sends nothing beyond the routes above. `/recorder/me` carries the
token's account (workspace, user email and name, or the key's label and
project) and four display preferences (`size`, `verbose`, and the sheet's
`sheetW`/`sheetH` in CSS px, sent in a PATCH of their own that a server
predating them answers 422). Those preferences
and the device's last five recordings (id, title, start time, length,
status, board link) are kept in `localStorage` under `vitrinka.recorder.*`.

The macOS recorder's HUD is a separate floating panel. Keyframes name the
captured windows explicitly, so the HUD and the annotate overlay are never
in one; the click and key lanes ignore events in them, and the console lane
skips the recorder's own log subsystem.

## The page recorder beside the extension

When a page embeds the web recorder and the browser also runs the Vitrinka
extension, the two coordinate as one recorder (web 0.5.0). They share only
the DOM, so every script on the page can read what they say there:
`data-vitrinka-page` on `<html>` (the recorder's id, `web/0.5.0`) and
`data-vitrinka-lead` (`{v, by, id, state, sessionId, since}`: which side
records, a random holder id, the state and the session's id). Actions are
`vitrinka:hello`, `vitrinka:command` and `vitrinka:ack` window events with
a JSON-string detail. None of it carries a title, workspace, project, URL or
credential, and neither side ever uses the other's credential. A command can
only pause, stop or add a note to the recording already under way. The
HUD is an open shadow root on the page, so a page script could already press
those buttons. Nothing of this goes over the network.

## Retention & access

Recorded sessions live on your vitrinka server under its access rules; the
recorders keep only an undelivered upload tail on-device (removed once
delivered or when the session is discarded; for the macOS recorder the files
under `~/Library/Application Support/<bundle id>/VitrinkaRecorder/`) — for the web recorder that
includes attached images waiting in IndexedDB. The web pill's flight-recorder
buffer is never on-device storage: it lives in the page's memory for at
most its two windows.
