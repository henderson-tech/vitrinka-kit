# VitrinkaRecorder (macOS)

The vitrinka journey recorder for native macOS apps (AppKit and SwiftUI).
Record a manual-testing session in your app — keyframes of its windows,
clicks, shortcuts, window and route changes, console errors, notes and
region annotations — straight into a [vitrinka](https://vitrinka.ai) board.

The recorder runs **only in Debug builds**. A Release build compiles the
same API as empty stubs, and a release check fails a binary that still
contains the live code (see [The Debug-only guarantee](#the-debug-only-guarantee)).

What it captures and where it goes is documented in
[`docs/PROTOCOL.md`](../../docs/PROTOCOL.md); this source is public so you
can verify it.

## Install

SwiftPM reads a manifest only at a repository root, so the kit's root
[`Package.swift`](../../Package.swift) describes this package. Swift tools
5.9, macOS 14.

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/henderson-tech/vitrinka-kit", branch: "main"),
],
targets: [
    .executableTarget(name: "MyApp", dependencies: [
        .product(name: "VitrinkaRecorder", package: "vitrinka-kit"),
    ]),
]
```

In Xcode: File › Add Package Dependencies…, the same URL, product
`VitrinkaRecorder`.

## Wire it up

```swift
import VitrinkaRecorder

func applicationDidFinishLaunching(_ notification: Notification) {
    #if DEBUG
    // Nothing starts without a URL: VITRINKA_RECORDER_URL in the environment,
    // or the user default VitrinkaRecorderURL.
    if var config = VitrinkaRecorderConfiguration.fromEnvironment(appID: "com.example.myapp.debug") {
        config.logs = .all(subsystems: ["com.example.myapp"])   // optional
        VitrinkaRecorder.configure(config)
    }
    #endif
}
```

`configure` installs the HUD (a small floating panel), the event monitor and
queue recovery. It records nothing until the tester presses Record in the
HUD, or the host calls `try await VitrinkaRecorder.start()`.

The server resolves the project and environment from the **app id** through
its project's Apps rules (an exact match). Add the id you pass (the bundle id
by default) to a project's Apps rules. Use a Debug-only id when Debug and
Release share a bundle id. A project-pinned recorder key records into its own
project even without a rule.

### Credentials

The recorder authenticates with an ingest-only `vkr_` recorder token. It
looks, in order, at:

1. `VITRINKA_RECORDER_TOKEN` in the environment (an admin-minted recorder
   key, for agent and CI runs);
2. the user default `VitrinkaRecorderToken` (for a debug app launched from
   Finder or Xcode without a shell environment);
3. the device link: the tester presses **Link this Mac** in the HUD, the
   approve page opens in the browser, and the minted token is stored in
   `link.json` (mode 0600, see [Storage](#storage)).

A 401 forgets a device link and ends the recording locally.
`credential: .deviceLink` uses only the link; `credential: .provider { … }`
takes a token the host already holds.

### Routes and lanes

Every top-level window is one lane (`tabId`): `main` for a SwiftUI
`WindowGroup(id: "main")`, `settings` for the Settings scene, else the
window's identifier or frame autosave name. Sheets and popovers belong to
their window's lane. A lane's route makes its `tabHost`, e.g.
`/main/details`:

```swift
DetailsSheet()
    .vitrinkaRoute("details")             // while this view is on screen
VitrinkaRecorder.setRoute("fan-control")  // the key window's lane
```

A route change, a key-window change and a sheet that begins or ends record a
`nav` event and a keyframe. `sanitizeRoute` rewrites every route before the
redaction engine scrubs it, for credentials in route paths.

### Private views

```swift
AccountView().vitrinkaPrivate()        // SwiftUI
balanceLabel.vitrinkaPrivate = true    // AppKit view
inspectorWindow.vitrinkaPrivate = true // never capture this window
```

A private view's frame is painted black on the keyframe before it is
encoded. `NSSecureTextField` and SwiftUI `SecureField` are private
automatically, and the key lane records nothing while one has focus. If a
private view on a captured window cannot be located, the frame is dropped.
Everything else is captured as rendered: mark private what you would not put
on a board.

### Event sources

The default `eventSource: .localMonitor` installs one local `NSEvent`
monitor (mouse-down and key-down, never `keyUp` or mouse moves). A host with
its own event plumbing sets `.manual` and forwards events:

```swift
config.eventSource = .manual
config.chords = .off
// in your sendEvent override or key router:
VitrinkaRecorder.observe(event)
```

## The HUD and the shortcuts

| State | HUD |
|---|---|
| Not linked | hollow ring, **Link this Mac** (then the code, **Open vitrinka**, Cancel) |
| Ready | dot, **Record**, Unlink (for a device link) |
| Recording | red dot (orange when paused), clock, frame count, sync state; pause, note, mark, annotate, stop |
| Recovered after a relaunch | the recording comes back paused: resume or stop |
| Stopped | **Saved**, **Open board** |

While the app is active: ⌥⇧N note, ⌥⇧P pause or resume, ⌥⇧S stop,
⌥⇧A annotate a region (drag a rectangle, type, Return). The HUD panel and
the annotate overlay are never in a keyframe and never reach a lane.

`VitrinkaRecorder.mark("text")` takes a keyframe and puts a note on it.

## The Debug-only guarantee

1. **Compile gate.** Every live file is wrapped in `#if DEBUG`. The public
   API file has `#if DEBUG` (live) / `#else` (empty stubs), so host code that
   uses `.vitrinkaPrivate()` or `VitrinkaRecorder.mark()` compiles unchanged
   in Release, and the Release binary contains no capture, HUD, queue or
   network code. SwiftPM defines `DEBUG` for `-c debug` builds of
   dependencies and not for `-c release`.
2. **Host gate.** Call `configure` inside `#if DEBUG`, as above.
3. **Release check (mandatory).** The live code sends the canary
   `vitrinka-macos-live/1` in its User-Agent, so the linker keeps the string
   whenever the live recorder is linked. Run the check on every Release
   binary:

   ```sh
   packages/macos/scripts/check-release-binary.sh path/to/MyApp.app   # or the executable
   ```

   | Exit | Meaning |
   |---|---|
   | 0 | clean: no live recorder (what a Release build must give) |
   | 1 | the canary is present: the live recorder is linked (a Debug build gives this) |
   | 2 | usage error, or no such file |

   Xcode defines `DEBUG` for package targets in the Debug configuration. For
   a custom configuration name, the check is the backstop.
4. **Runtime gate.** Even in Debug, nothing starts without a URL.

## Storage

All under `~/Library/Application Support/<bundle id>/VitrinkaRecorder/`
(the app id when the process has no bundle id), directory mode 0700, files
0600:

| File | What |
|---|---|
| `session.json` | the running session (survives a relaunch) |
| `buffer.json` | events not yet delivered |
| `pending.json`, `pending/<seq>.jpg` | keyframes waiting for their upload |
| `link.json` | the device-link token |

The tail is removed once delivered, or when the session ends locally. Stop
drains for up to 60 s; offline it keeps the tail, pauses the recording and
asks to stop again once online.

## Run the demo

[`Examples/RecorderDemo`](Examples/RecorderDemo) is a small SwiftUI app
(main window, Settings, a sheet, buttons, a text field, a SecureField and a
private panel) under the app id `dev.vitrinka.recorder-demo`. Add that id to
a project's Apps rules on your server, then:

```sh
# Build and bundle (bundle id dev.vitrinka.recorder-demo, ad hoc signed).
# The last line is the app's path.
packages/macos/scripts/bundle-demo.sh debug --out /tmp/vitrinka-demo

# Run it from the terminal so it inherits the environment.
VITRINKA_RECORDER_URL=http://127.0.0.1:8090 \
VITRINKA_RECORDER_TOKEN=vkr_… \
  /tmp/vitrinka-demo/debug/RecorderDemo.app/Contents/MacOS/RecorderDemo
```

Without `VITRINKA_RECORDER_TOKEN`, press **Link this Mac** in the HUD. To
launch the app from Finder instead, set the user defaults
(`defaults write dev.vitrinka.recorder-demo VitrinkaRecorderURL http://…`).
`swift run RecorderDemo` also works; that process has no bundle id.

## Develop

```sh
swift build                    # Debug: the live recorder
swift build -c release         # Release: stubs only
swift test                     # Core (queue, wire, device link, redaction vectors) and AppKit helpers

# Concurrency: clean in Swift 5 mode with complete checking, and in Swift 6 mode.
swift build -Xswiftc -strict-concurrency=complete
swift build -Xswiftc -swift-version -Xswiftc 6

# The contract against a running vitrinka (skipped without both variables).
VITRINKA_E2E_URL=http://127.0.0.1:8090 VITRINKA_E2E_TOKEN=vkr_… swift test --filter LiveServerTests
```

The redaction engine is a Swift port of [`@vitrinka/redact`](../redact).
`Tests/VitrinkaRecorderCoreTests/Resources/vectors.json` is a copy of
`packages/redact/spec/vectors.json`; a test fails when they differ.

## Not yet

- Network capture (an opt-in `URLSession` observer).
- Image attachments on notes, note edits (`cid`, `replaces`, `refs`).
- The policy's `attachments` switch, machine-driven runs (`driver: "ai"`), a
  global hotkey.
- A one-line summary of plain typing when a text field ends editing.

## License

[Elastic License 2.0](../../LICENSE), like the rest of this repository.
