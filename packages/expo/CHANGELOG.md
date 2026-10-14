# @vitrinka/expo

## 0.2.3

- **Credentials in route paths no longer reach vitrinka (`sanitizeUrl`).**
  The recorder stamped the router's pathname, unredacted, as the `tabHost`
  of every event and the `route` of navigations, taps and keyframes. An
  expo-router app with a `reset-password/[token]` or `invite/[token]` screen
  uploaded the token with every event recorded on it. `VitrinkaRecorderRoot`
  now takes an optional `sanitizeUrl: (url: string) => string`, the same
  contract as `@vitrinka/web` 0.5.3. It rewrites every route and network
  request URL before the redaction engine scrubs it, under `fullFidelity`
  too. A sanitizer that throws or returns a non-string fails closed: the
  recorder keeps only the URL's origin, or `[redacted]` for a bare route,
  and logs one warning. See
  [Credentials in URL paths](README.md#credentials-in-url-paths-sanitizeurl).
- **Routes are redacted.** Every route now passes the same scrub as a URL,
  under the policy in force when the event is recorded, so a workspace's
  value patterns reach routes too. Without a `sanitizeUrl`, a route that
  matches no pattern is recorded as before. A lane (`tabId`) is unchanged.
  In the timeline's Domain view, routes that differ only in a sanitized
  segment now share one lane.
- `hideIdleGripOn` still matches the raw pathname, and the annotate
  composer shows the route the note is filed under.

## 0.2.2

- **The web HUD's design, native.** The right-edge rail, grip and mini tab
  give way to the same shapes as `@vitrinka/web` 0.1.2: a 32pt glass puck at
  idle (tap links or records, long-press for unlink and move), a dot-and-clock
  capsule while recording that a tap unfolds into the tools (frames · sync ·
  pause · note · annotate · more) and that folds back 4s after the last touch.
  Annotate lives in the tray (held open while the mode is on) instead of a
  permanent chip.
- **Move it anywhere.** Drag it to one of six spots, flick it where you want
  it, or push it past a side edge to tuck it into a 6pt tab (`Show recorder`);
  the menu's **Move to** picker is the no-drag alternative. The spot is
  remembered (`vitrinka.recorder.dock`) and respects the safe area.
- Link, note and the menu are bottom sheets riding the keyboard; state
  changes are announced to VoiceOver/TalkBack. No new native dependency (core
  `PanResponder` + `Animated`). Needs `@vitrinka/link` 0.1.2.
- `hideIdleGripOn` still hides the idle puck on the listed routes.

## 0.2.1

- **Link into the right workspace**: an `EXPO_PUBLIC_VITRINKA_URL` addressing
  `/w/<slug>` preselects that workspace on the approve page, and a token
  approved into any other one is discarded instead of stored (it would 401
  on every door and loop back to Link recorder); the rail's link sheet says
  `linked into <x> — this app records into <slug>; link again and pick
  <slug>`. Needs `@vitrinka/link` ≥ 0.1.1.

## 0.2.0

- **Device link replaces the baked token.** The recorder is enabled by
  `EXPO_PUBLIC_VITRINKA_URL` alone; the tester links the device from the pill
  (a short code, "Open vitrinka" for the same-device path — a Netflix-style
  flow via the new `@vitrinka/link`), which mints an ingest-only `vkr_` token
  stored under `vitrinka.recorder.link`. `EXPO_PUBLIC_VITRINKA_TOKEN` remains
  for unattended builds and must now hold an admin-minted `vkr_` recorder key,
  never a workspace token. A 401 from any door forgets the link; "Unlink" in
  the rail does the same on purpose. `withRecorderStrip` / the config plugin
  decide the strip on the URL.
- Recovery refetches a redaction policy whose start-time fetch never settled;
  the recovery fetch is single-flight.
- The captured content type is forwarded to the redaction engine (form and
  multipart bodies get their shape-aware transforms); multipart bodies beyond
  the 64 KiB cap record as an omission marker.
- Annotation rects are scaled with the held frame's own capture scale (blur
  policy); the policy applies at session start without blocking capture.
- Shared `@vitrinka/redact` engine; policy-driven redaction
  (`GET /api/v1/recorder/policy`, fail-closed).
- Packaging: ELv2 LICENSE inside the npm package; publish tags must be
  reachable from main.

## 0.1.0

- Initial release.
