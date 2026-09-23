# @vitrinka/expo

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
