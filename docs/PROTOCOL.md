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
GET   /api/v1/recorder/policy      workspace redaction policy (session start)
POST  /api/v1/sessions             create a recording session
POST  /api/v1/sessions/:id/events  the event stream (batched)
POST  /api/v1/sessions/:id/shot    screenshot keyframes (Expo, extension)
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
  recording survives a reload of the same tab and continues in it.

## What is captured (per session)

| Channel | Expo recorder | Browser extension | Web recorder |
|---|---|---|---|
| Screenshots | keyframes on navigation/touch (throttled) | keyframes + rrweb DOM stream | **none** — the rrweb DOM stream is the keyframe (input values always masked, all text under `maskAllText`; images recorded by URL, never inlined) |
| Interactions | tap coordinates + pressed-element label + route | clicks, navigation | clicks (short selector, element text, rect), navigation (pushState/replaceState/popstate or the router's pathname) |
| Network | method, URL, status, duration, capped request/response headers + bodies (redacted) | API calls incl. headers + bodies (via CDP) | fetch + XHR: method, URL, status, duration, capped request/response headers + bodies (redacted); never the recorder's own uploads |
| Console | errors/warnings | errors | `console.error`, uncaught errors, unhandled rejections |
| Notes | notes you type in the HUD | notes you type in the popup | notes and element/region annotations you type in the HUD |

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
  (OAuth callbacks, magic links, SAS URLs), with `;`-separated pairs handled.
- **Multipart uploads beyond the 64 KiB body cap record as an omission
  marker**, not a partial body: a truncated multipart body cannot be parsed
  into parts, and a partial scan would leak exactly the fields the key scrub
  protects — the recorders fail closed instead.

The Expo and web recorders apply this engine today; the browser extension's
port ships in its next release (the vitrinka server additionally applies the
same redaction at ingest for every client, so recordings from any client
never store raw secrets). The web recorder additionally feeds the engine's
`maskDirectives` to rrweb, so the DOM stream never carries input values and,
under `maskAllText`, no text at all; console text runs through the same
`redactText` pass as bodies.

At session start the recorder fetches your workspace's redaction policy
(`GET /api/v1/recorder/policy`), which can only ADD rules: extra header
names, extra body keys, extra patterns, or `maskAllText`. If the fetch fails,
the built-in defaults above apply — **never** capture-everything. A
`fullFidelity` policy (self-hosted deployments only; the server refuses to
serve it otherwise) restores unredacted capture.

Screenshots carry real rendered pixels and are not content-filtered by
default. Under a `maskAllText` policy the Expo recorder captures keyframes at
a strongly reduced resolution (text unreadable, layout visible). The web
recorder takes no screenshots at all. Otherwise: do not record against
screens showing data you would not put on the session's board.

## Retention & access

Recorded sessions live on your vitrinka server under its access rules; the
recorders keep only an undelivered upload tail on-device (removed once
delivered or when the session is discarded).
