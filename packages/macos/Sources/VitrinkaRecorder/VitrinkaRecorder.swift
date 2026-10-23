// The public API of the vitrinka journey recorder for macOS.
//
// Debug builds compile the live recorder. Release builds compile the same
// symbols as empty stubs, so host code builds unchanged and a Release binary
// carries no capture, HUD, queue or network code. Every other file of this
// module and of VitrinkaRecorderCore is wrapped in `#if DEBUG`.
// scripts/check-release-binary.sh proves it on a built binary.

import AppKit
import SwiftUI

/// How the recorder is set up. Data only: it records nothing by itself.
public struct VitrinkaRecorderConfiguration: Sendable {
    /// The vitrinka base URL, e.g. `https://app.vitrinka.ai/w/acme`.
    public var baseURL: URL
    /// The app id the server resolves project and environment from (its Apps
    /// rules). Default: the bundle id. Set it when Debug and Release builds
    /// share a bundle id.
    public var appID: String?
    /// Default: `CFBundleShortVersionString`.
    public var appVersion: String?
    /// An explicit server lane. Omit it and the app-id rule decides.
    public var environment: String?
    public var credential: Credential = .automatic
    public var eventSource: EventSource = .localMonitor
    /// ⌥⇧N note, ⌥⇧P pause, ⌥⇧S stop, ⌥⇧A annotate, while the app is active.
    public var chords: Chords = .standard
    public var hud: HUDMode = .floating
    public var keys: KeyCapture = .shortcutsOnly
    public var logs: LogCapture = .errors
    /// Rewrites every route before the redaction engine scrubs it, for
    /// credentials in route paths (`reset/<token>`). It runs under any policy.
    public var sanitizeRoute: (@Sendable (String) -> String)?
    /// While recording, set `AXEnhancedUserInterface` on the app (what an
    /// assistive client such as VoiceOver sets) so SwiftUI builds its
    /// accessibility tree and clicks on SwiftUI controls get names. Stop
    /// restores the previous value. Like VoiceOver, it can change how the app
    /// animates window moves and resizes. Off: SwiftUI clicks may have no name.
    public var activatesAccessibilityTree = true

    public enum Credential: Sendable {
        /// `VITRINKA_RECORDER_TOKEN` in the environment, else the user default
        /// `VitrinkaRecorderToken`, else the device link made from the HUD.
        case automatic
        /// Only the device link (`link.json`).
        case deviceLink
        /// A host-supplied ingest token, read before every request.
        case provider(@Sendable () -> String?)
    }

    /// `.manual`: the recorder installs no event monitor; the host forwards
    /// events with `VitrinkaRecorder.observe(_:)`.
    public enum EventSource: Sendable { case localMonitor, manual }
    public enum Chords: Sendable { case standard, off }
    public enum HUDMode: Sendable { case floating, hidden }
    /// `.shortcutsOnly`: ⌘ and ⌃ chords, Return, Escape, Tab, arrows and
    /// Delete. Typed characters are never recorded.
    public enum KeyCapture: Sendable { case off, shortcutsOnly }
    /// Which unified-log entries of this process the console lane records.
    ///
    /// Only the app's own subsystems count: the bundle id and the app id
    /// (each also without a trailing `.debug`, `.dev`, `.development`,
    /// `.staging`, `.beta`, `.test` or `.qa`), every subsystem under them,
    /// and the ones listed here. Framework entries and lines without a
    /// subsystem stay out, unless a line without a subsystem (`NSLog`) starts
    /// with one of `unlabelledPrefixes`. The recorder's own subsystem is
    /// always skipped.
    public struct LogCapture: Sendable, Equatable {
        public var enabled: Bool
        /// More subsystems that count as the app's own.
        public var subsystems: [String]
        /// Every entry of those subsystems except debug, not only errors and
        /// faults.
        public var allLevels: Bool
        /// Lines without a subsystem (`NSLog("myapp: …")`) whose text starts
        /// with one of these prefixes. Empty prefixes are ignored.
        public var unlabelledPrefixes: [String]

        public init(enabled: Bool = true, subsystems: [String] = [], allLevels: Bool = false, unlabelledPrefixes: [String] = []) {
            self.enabled = enabled
            self.subsystems = subsystems
            self.allLevels = allLevels
            self.unlabelledPrefixes = unlabelledPrefixes.filter { !$0.isEmpty }
        }

        public static let off = LogCapture(enabled: false)
        /// Error and fault entries of the app's own subsystems.
        public static let errors = LogCapture()

        /// Error and fault entries of the app's own subsystems and these, plus
        /// the matching lines without a subsystem.
        public static func errors(subsystems: [String] = [], unlabelledPrefixes: [String] = []) -> LogCapture {
            LogCapture(subsystems: subsystems, unlabelledPrefixes: unlabelledPrefixes)
        }

        /// Every entry except debug of the app's own subsystems and these, plus
        /// the matching lines without a subsystem.
        public static func all(subsystems: [String] = [], unlabelledPrefixes: [String] = []) -> LogCapture {
            LogCapture(subsystems: subsystems, allLevels: true, unlabelledPrefixes: unlabelledPrefixes)
        }
    }

    public init(baseURL: URL, appID: String? = nil) {
        self.baseURL = baseURL
        self.appID = appID
    }

    /// The URL from `VITRINKA_RECORDER_URL` in the environment, else the user
    /// default `VitrinkaRecorderURL`; nil when neither is a valid http(s)
    /// URL. Release builds always answer nil.
    public static func fromEnvironment(appID: String? = nil) -> VitrinkaRecorderConfiguration? {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment["VITRINKA_RECORDER_URL"]
        let candidates = [env, UserDefaults.standard.string(forKey: "VitrinkaRecorderURL")]
        for raw in candidates {
            guard let s = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty,
                  let url = URL(string: s), let scheme = url.scheme?.lowercased(),
                  scheme == "http" || scheme == "https", url.host != nil
            else { continue }
            return VitrinkaRecorderConfiguration(baseURL: url, appID: appID)
        }
        return nil
        #else
        return nil
        #endif
    }
}

/// A snapshot of the recorder for host UI.
public struct VitrinkaRecorderState: Sendable, Equatable {
    public enum Sync: String, Sendable { case idle, ok, backlog, offline, dead }

    public var isConfigured = false
    public var isLinked = false
    public var isRecording = false
    public var isPaused = false
    public var sessionID: String?
    public var frames = 0
    public var queued = 0
    public var sync: Sync = .idle
    /// The board of the last stopped recording.
    public var lastBoardURL: URL?

    public init() {}
}

public enum VitrinkaRecorderError: Error, Sendable, Equatable, CustomStringConvertible {
    case notConfigured
    case notLinked
    case alreadyRecording
    case notRecording
    /// The server stayed unreachable; the tail is kept on disk and the
    /// recording paused. Stop again once online.
    case offline(queued: Int)
    /// The server refused the session; it ended locally.
    case sessionEnded(reason: String)
    /// The token was rejected (401); a device link was forgotten.
    case unauthorized
    case server(status: Int, message: String)

    public var description: String {
        switch self {
        case .notConfigured: return "the recorder is not configured (no VITRINKA_RECORDER_URL)"
        case .notLinked: return "this Mac is not linked to vitrinka"
        case .alreadyRecording: return "a recording is already running"
        case .notRecording: return "no recording is running"
        case let .offline(queued): return "server unreachable — \(queued) item(s) kept on disk; stop again once online"
        case let .sessionEnded(reason): return reason
        case .unauthorized: return "the recorder token was rejected — link this Mac again"
        case let .server(status, message): return status == 0 ? message : "server answered \(status): \(message)"
        }
    }
}

#if DEBUG

@MainActor
public enum VitrinkaRecorder {
    /// Installs the HUD, the event monitors and queue recovery. Records
    /// nothing until `start()`. A second call is ignored.
    public static func configure(_ configuration: VitrinkaRecorderConfiguration) {
        RecorderRuntime.configure(configuration)
    }

    public static func start(title: String? = nil) async throws {
        guard let rt = RecorderRuntime.shared else { throw VitrinkaRecorderError.notConfigured }
        try await rt.start(title: title)
    }

    public static func pause() async {
        await RecorderRuntime.shared?.setPaused(true)
    }

    public static func resume() async {
        await RecorderRuntime.shared?.setPaused(false)
    }

    /// Drains the queue, marks the session done and waits (bounded) for its
    /// board. Returns the board URL, or nil when the board was not ready in
    /// time. Throws when offline; the tail stays on disk.
    public static func stop() async throws -> URL? {
        guard let rt = RecorderRuntime.shared else { throw VitrinkaRecorderError.notConfigured }
        return try await rt.stop()
    }

    /// "Something happened here": a forced keyframe, then a note on it.
    public static func mark(_ text: String = "") {
        RecorderRuntime.shared?.mark(text)
    }

    /// Region annotate on the key window (the same as ⌥⇧A).
    public static func annotate() {
        RecorderRuntime.shared?.annotate()
    }

    /// A note on the current screen of the key window's lane.
    public static func note(_ text: String) {
        RecorderRuntime.shared?.note(text)
    }

    /// The route of a window's lane (default: the key window), e.g.
    /// "settings/general". A change records a navigation and a keyframe.
    public static func setRoute(_ route: String, window: NSWindow? = nil) {
        RecorderRuntime.shared?.setRoute(route, window: window)
    }

    /// For hosts with `eventSource: .manual`: forward mouse-down and key-down
    /// events. Observe only; the event is not changed.
    public static func observe(_ event: NSEvent) {
        RecorderRuntime.shared?.observe(event)
    }

    /// Forget the device-link token. A running recording ends locally.
    public static func unlink() async {
        await RecorderRuntime.shared?.unlink()
    }

    public static var state: VitrinkaRecorderState {
        RecorderRuntime.shared?.publicState ?? VitrinkaRecorderState()
    }
}

extension View {
    /// Paints this view's frame black in every keyframe. A frame whose
    /// private view cannot be located is dropped.
    public func vitrinkaPrivate(_ isPrivate: Bool = true) -> some View {
        background(PrivateMarker(isPrivate: isPrivate))
    }

    /// Sets the window lane's route while this view is on screen.
    public func vitrinkaRoute(_ route: String) -> some View {
        background(RouteMarker(route: route))
    }
}

extension NSView {
    /// Paint this view's frame black in every keyframe.
    @MainActor public var vitrinkaPrivate: Bool {
        get { PrivateRegistry.shared.contains(self) }
        set { PrivateRegistry.shared.set(self, private: newValue) }
    }
}

extension NSWindow {
    /// Never capture this window; its lane records events without keyframes.
    @MainActor public var vitrinkaPrivate: Bool {
        get { PrivateRegistry.shared.containsWindow(self) }
        set { PrivateRegistry.shared.setWindow(self, private: newValue) }
    }
}

#else

// Release: the same surface, inert. Nothing below captures, stores or sends.

@MainActor
public enum VitrinkaRecorder {
    @inlinable public static func configure(_ configuration: VitrinkaRecorderConfiguration) {}
    @inlinable public static func start(title: String? = nil) async throws {}
    @inlinable public static func pause() async {}
    @inlinable public static func resume() async {}
    @inlinable public static func stop() async throws -> URL? { nil }
    @inlinable public static func mark(_ text: String = "") {}
    @inlinable public static func annotate() {}
    @inlinable public static func note(_ text: String) {}
    @inlinable public static func setRoute(_ route: String, window: NSWindow? = nil) {}
    @inlinable public static func observe(_ event: NSEvent) {}
    @inlinable public static func unlink() async {}
    @inlinable public static var state: VitrinkaRecorderState { VitrinkaRecorderState() }
}

extension View {
    @inlinable public func vitrinkaPrivate(_ isPrivate: Bool = true) -> some View { self }
    @inlinable public func vitrinkaRoute(_ route: String) -> some View { self }
}

extension NSView {
    @MainActor public var vitrinkaPrivate: Bool {
        get { false }
        set {}
    }
}

extension NSWindow {
    @MainActor public var vitrinkaPrivate: Bool {
        get { false }
        set {}
    }
}

#endif
