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
    @Published var elapsed: TimeInterval = 0
    @Published var frames = 0
    @Published var queued = 0
    @Published var sync: Sync = .ok
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

    var clock: String {
        let s = Int(elapsed)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
#endif
