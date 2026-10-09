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
[`packages/web/src/protocol`](../packages/web/src/protocol/index.ts)) and ride
these routes:

```
GET   /api/v1/recorder/policy      workspace redaction policy + the attachments switch (session start; the web pill's flight recorder)
GET   /api/v1/recorder/me          who the token is + HUD prefs (web HUD)
PATCH /api/v1/recorder/me          HUD prefs {size, verbose} (web HUD, linked devices)
POST  /api/v1/sessions             create a recording session
POST  /api/v1/sessions/:id/events  the event stream (batched)
POST  /api/v1/sessions/:id/shot    screenshot keyframes (Expo, extension); images a tester attached (below)
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

## What is captured (per session)

| Channel | Expo recorder | Browser extension | Web recorder |
|---|---|---|---|
| Screenshots | keyframes on navigation/touch (throttled) | keyframes + rrweb DOM stream | **none** — the rrweb DOM stream is the keyframe (input values always masked, all text under `maskAllText`; images recorded by URL, never inlined) |
| Interactions | tap coordinates + pressed-element label + route | clicks, navigation | clicks (short selector, element text — never a form field's value, see Redaction — rect), navigation (pushState/replaceState/popstate or the router's pathname) |
| Network | method, URL, status, duration, capped request/response headers + bodies (redacted) | API calls incl. headers + bodies (via CDP) | fetch + XHR: method, URL, status, duration, capped request/response headers + bodies (redacted); never the recorder's own uploads |
| Console | errors/warnings | errors | `console.error`, uncaught errors, unhandled rejections |
| Notes | notes you type in the HUD | notes you type in the popup | notes and element/region annotations you type in the HUD, and images you attach to them (below) |

Every web session's create carries `meta.recorder` (`web/<version>`),
`meta.platform` (`web`), `meta.userAgent`, `meta.appVersion` when the host
passes one, and `meta.devicePixelRatio` — the scale every recorded rect is
in, so the server renders its stills at it.

### Bug reports (web recorder)

"Report a bug" in the pill's ⋯ menu files what led up to a bug without a
recording running:

- **What the idle pill keeps** (the flight recorder): the rrweb DOM stream as
  two checkout windows of 30 s (a clip covers the last 30–60 s and always
  opens on a full snapshot), and the click, navigation, console and network
  events since the older window opened — capped at 4 MiB of serialized
  rrweb, 20 000 rrweb events and 500 lane events (over a cap the older
  window goes). It is captured under exactly the redaction a recording uses
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
  on every full snapshot.
- **Values**: a PEM private key (`-----BEGIN … PRIVATE KEY-----`, any key
  type, encrypted or not) is scrubbed wherever it appears — a body field
  under any name, a form value, a console line — even when a size cap cut
  off its END line. Certificates and public keys stay.
- **Multipart uploads beyond the 64 KiB body cap record as an omission
  marker**, not a partial body: a truncated multipart body cannot be parsed
  into parts, and a partial scan would leak exactly the fields the key scrub
  protects — the recorders fail closed instead.

All three clients apply this engine — Expo and web import it directly, and
the browser extension carries a generated copy (`vendor/redact.js`, kept in
sync by a CI drift check). The vitrinka server additionally applies the same
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
default. Under a `maskAllText` policy Expo and extension capture keyframes at
a strongly reduced resolution (text unreadable, layout visible; the extension
drops a frame it cannot downscale rather than storing it raw). The web
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
project) and two display preferences (`size`, `verbose`). Those preferences
and the device's last five recordings (id, title, start time, length,
status, board link) are kept in `localStorage` under `vitrinka.recorder.*`.

## Retention & access

Recorded sessions live on your vitrinka server under its access rules; the
recorders keep only an undelivered upload tail on-device (removed once
delivered or when the session is discarded) — for the web recorder that
includes attached images waiting in IndexedDB. The web pill's flight-recorder
buffer is never on-device storage: it lives in the page's memory for at
most its two windows.
