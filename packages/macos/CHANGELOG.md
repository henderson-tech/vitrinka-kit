# VitrinkaRecorder (macOS)

## 0.1.0

- First version: the journey recorder for native macOS apps, Debug builds
  only. Keyframes of the app's own windows through ScreenCaptureKit (no
  Screen Recording permission), clicks with accessibility labels, shortcut
  keys, window lanes and routes, console errors from the unified log, notes,
  marks and region annotations, a floating HUD with the ⌥⇧N/P/S/A chords,
  private views painted black, the device link, a durable queue that
  survives a relaunch, and a Swift port of `@vitrinka/redact` that passes
  its conformance vectors. Release builds compile the API to empty stubs;
  `scripts/check-release-binary.sh` fails a binary that links the live
  recorder.
