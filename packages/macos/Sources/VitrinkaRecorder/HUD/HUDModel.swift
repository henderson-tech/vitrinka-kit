#if DEBUG
import AppKit
import Combine
import SwiftUI

/// What the HUD shows. The runtime owns it and refreshes it once a second
/// while a recording runs.
@MainActor
final class HUDModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case linking
        case starting
        case recording
        case stopping
        case saved
    }

    enum Sync: Equatable { case ok, backlog, offline, dead }

    @Published var phase: Phase = .idle
    @Published var linked = false
    /// True when the credential comes from the device link (Unlink applies).
    @Published var linkedByDevice = false
    @Published var paused = false
    @Published var recovered = false
    /// The clock and counters change every second; they live in their own
    /// object so that only the status strip re-renders, never the buttons.
    let status = HUDStatus()
    @Published var userCode: String?
    @Published var verifyURL: URL?
    @Published var boardURL: URL?
    @Published var savedSessionID: String?
    @Published var message: String?
    @Published var noteOpen = false
    @Published var noteText = ""

    var onStart: () -> Void = {}
    var onStop: () -> Void = {}
    var onTogglePause: () -> Void = {}
    var onNote: (String) -> Void = { _ in }
    var onMark: () -> Void = {}
    var onAnnotate: () -> Void = {}
    var onLink: () -> Void = {}
    var onCancelLink: () -> Void = {}
    var onUnlink: () -> Void = {}
    var onOpenURL: (URL) -> Void = { _ in }
    var onDismissSaved: () -> Void = {}
    /// The HUD needs keyboard focus (the note field) or gives it back.
    var onWantsKey: (Bool) -> Void = { _ in }

    func openNote() {
        noteText = ""
        noteOpen = true
        onWantsKey(true)
    }

    func submitNote() {
        let text = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        noteOpen = false
        noteText = ""
        onWantsKey(false)
        if !text.isEmpty { onNote(text) }
    }

    func cancelNote() {
        noteOpen = false
        noteText = ""
        onWantsKey(false)
    }

}

/// The once-a-second part of the HUD: clock, frame count, sync state.
@MainActor
final class HUDStatus: ObservableObject {
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var frames = 0
    @Published private(set) var queued = 0
    @Published private(set) var sync: HUDModel.Sync = .ok

    func update(elapsed: TimeInterval, frames: Int, queued: Int, sync: HUDModel.Sync) {
        if Int(self.elapsed) != Int(elapsed) { self.elapsed = elapsed }
        if self.frames != frames { self.frames = frames }
        if self.queued != queued { self.queued = queued }
        if self.sync != sync { self.sync = sync }
    }

    var clock: String {
        let s = Int(elapsed)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
#endif
