# @vitrinka/expo

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
