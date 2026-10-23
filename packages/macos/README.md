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
        config.logs = .errors(unlabelledPrefixes: ["myapp:"])   // optional, see Console
        VitrinkaRecorder.configure(config)
    }
    #endif
}
```

`configure` installs the HUD (a small floating panel), the event monitor and
queue recovery. It records nothing until the tester presses Record in the
HUD, or the host calls `try await VitrinkaRecorder.start()`. A session
without a title is named "<app name> · <local date and time>".

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

### Clicks and their names

A click records where it landed (in the keyframe's pixels) and what it
landed on: the control's accessibility label or title (a list row's own
text), with `role#identifier` as the selector. A text field's value is never
read, and a click inside a private view records no name.

SwiftUI builds its accessibility tree only while an assistive client is
active. While a recording runs (Debug builds only), the recorder therefore
sets `AXEnhancedUserInterface` on its own app's accessibility element, as
VoiceOver does, so SwiftUI controls have names; Stop restores the previous
value. Nothing outside the app changes and no permission is involved, but
like VoiceOver it can change how the app animates window moves and resizes.
`config.activatesAccessibilityTree = false` turns this off; SwiftUI clicks
then may have no name. A control without a name keeps the click's position
and role.

In-process accessibility frames come in two coordinate systems: SwiftUI's
nodes answer AppKit screen coordinates (origin at the bottom left), while
some AppKit elements (table cells, hosting views, the sheet window) answer
top-left numbers. The recorder compares every frame with the clicked window
and the sheets and popovers over it: it keeps a frame that meets the window,
else it uses the frame flipped over the main screen's height. An element
that the accessibility hit test returns is never dropped by a frame check.

### Console

The console lane reads the app's own unified log (no entitlement) while a
recording runs:

- `.errors` (the default): error and fault entries of the app's own
  subsystems — the bundle id and the app id (each also without a trailing
  `.debug`, `.dev`, `.development`, `.staging`, `.beta`, `.test` or `.qa`)
  and every subsystem under them. `Logger.warning` writes at the error level,
  so the host's warnings count too.
- `.errors(subsystems:unlabelledPrefixes:)`: also other subsystems you name,
  and lines without a subsystem (`NSLog`) that start with one of your
  prefixes, e.g. `.errors(unlabelledPrefixes: ["pultik:"])`.
- `.all(subsystems:unlabelledPrefixes:)`: every level except debug of the
  same subsystems.
- `.off`.

Framework lines without a subsystem (CoreAudio, caches) never count. A line
that repeats within 60 s (the same subsystem, category and text, with numbers
ignored) is sent once, then once more as a summary with `repeats: N`. A
session sends at most 200 console entries, then one "console lane capped"
entry.

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
the annotate overlay are never in a keyframe and never reach a lane. The HUD
buttons have accessibility labels ("Pause", "Note", "Mark this moment",
"Annotate a region", "Stop and save") and identifiers (`vitrinka-hud-pause`,
`-note`, `-mark`, `-annotate`, `-stop`) for VoiceOver and UI automation.

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
