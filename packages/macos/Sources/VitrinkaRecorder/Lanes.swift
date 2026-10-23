#if DEBUG
import AppKit
import VitrinkaRecorderCore

/// Windows the recorder itself owns (the HUD, the annotate overlay). They
/// are never captured, and their events never reach a lane.
protocol RecorderChromeWindow: NSWindow {}

/// Window lanes: one `tabId` per top-level window. The vitrinka projection
/// builds journey branches per `tabId`, so a lane per window keeps each
/// window's journey straight. Sheets, popovers and other child windows
/// belong to the lane of their top-level window.
@MainActor
enum Lanes {
    /// The top-level window a window belongs to (through sheet parents and
    /// parent windows).
    static func laneWindow(of window: NSWindow) -> NSWindow {
        var w = window
        var hops = 0
        while hops < 8 {
            hops += 1
            if let p = w.sheetParent {
                w = p
            } else if let p = w.parent, !(p is RecorderChromeWindow) {
                w = p
            } else {
                break
            }
        }
        return w
    }

    /// Whether events of this window belong to a recorded lane.
    static func isRecordable(_ window: NSWindow?) -> Bool {
        guard let window else { return false }
        if window is RecorderChromeWindow { return false }
        return !(laneWindow(of: window) is RecorderChromeWindow)
    }

    /// The lane window the user works in now: the key window, else the main
    /// window, else the frontmost visible app window.
    static func currentLaneWindow() -> NSWindow? {
        for candidate in [NSApp.keyWindow, NSApp.mainWindow] {
            if let w = candidate, isRecordable(w) { return laneWindow(of: w) }
        }
        return NSApp.orderedWindows.first { $0.isVisible && isRecordable($0) && $0.sheetParent == nil && $0.parent == nil }
    }

    /// Visible child windows (an attached sheet, popovers) drawn over a lane
    /// window, which its keyframe must include.
    static func overlays(of laneWindow: NSWindow) -> [NSWindow] {
        var out: [NSWindow] = []
        var sheet = laneWindow.attachedSheet
        while let s = sheet, s.isVisible, out.count < 4 {
            out.append(s)
            sheet = s.attachedSheet
        }
        for c in laneWindow.childWindows ?? [] where c.isVisible && !(c is RecorderChromeWindow) && !out.contains(where: { $0 === c }) {
            out.append(c)
        }
        return out
    }

    /// A short, stable lane id for a window: its identifier (SwiftUI scene
    /// ids are tidied: `main-AppWindow-1` → `main`), else its frame autosave
    /// name, else `window-<number>`. Titles are not used: they change and
    /// may name documents.
    static func laneID(for window: NSWindow) -> String {
        if let id = window.identifier?.rawValue, !id.isEmpty { return tidy(id) }
        if !window.frameAutosaveName.isEmpty { return tidy(window.frameAutosaveName) }
        return "window-\(window.windowNumber)"
    }

    nonisolated static func tidy(_ raw: String) -> String {
        var s = raw
        var instance = 1
        if let r = s.range(of: "-AppWindow-", options: .backwards) {
            instance = Int(s[r.upperBound...]) ?? 1
            s = String(s[..<r.lowerBound])
            // An unnamed WindowGroup's identifier is a SwiftUI type name.
            if s.contains("SwiftUI.") || s.contains("<") { s = "main" }
            if s.hasSuffix("-1") { s.removeLast(2) }
        }
        if s.lowercased().contains("swiftui_settings") || s == "com_apple_SwiftUI_Settings_window" { s = "settings" }
        var out = ""
        var dash = false
        for u in s.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(u) && u.isASCII {
                out.unicodeScalars.append(u)
                dash = false
            } else if !dash, !out.isEmpty {
                out += "-"
                dash = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        if out.isEmpty { out = "window" }
        if out.count > 40 { out = String(out.prefix(40)) }
        return instance > 1 ? "\(out)-\(instance)" : out
    }

    /// The `tabHost` of a lane: `/<lane>[/<route>]`.
    nonisolated static func path(lane: String, route: String) -> String {
        let r = route.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        return r.isEmpty ? "/\(lane)" : "/\(lane)/\(r)"
    }
}

/// The key lane's vocabulary: which key-downs are recorded, and how.
enum KeyCombos {
    static let specialNames: [UInt16: String] = [
        36: "↩", 76: "⌤", 53: "⎋", 48: "⇥", 51: "⌫", 117: "⌦",
        123: "←", 124: "→", 125: "↓", 126: "↑",
    ]

    /// The chord a key-down is, by physical key (⌥ rewrites characters).
    enum Chord: Equatable { case annotate, note, pause, stop }

    static func chord(keyCode: UInt16, flags: NSEvent.ModifierFlags) -> Chord? {
        let f = flags.intersection(.deviceIndependentFlagsMask)
        guard f.contains(.option), f.contains(.shift), !f.contains(.command), !f.contains(.control) else { return nil }
        switch keyCode {
        case 0: return .annotate
        case 45: return .note
        case 35: return .pause
        case 1: return .stop
        default: return nil
        }
    }

    /// The combo text of a recordable key-down, or nil for plain typing.
    /// Only ⌘/⌃ chords and the special keys qualify; a character typed with
    /// at most ⇧/⌥ is never recorded.
    static func combo(keyCode: UInt16, flags: NSEvent.ModifierFlags, charactersIgnoringModifiers: String?) -> String? {
        let f = flags.intersection(.deviceIndependentFlagsMask)
        let chord = f.contains(.command) || f.contains(.control)
        let special = specialNames[keyCode]
        guard chord || special != nil else { return nil }
        var s = ""
        if f.contains(.control) { s += "⌃" }
        if f.contains(.option) { s += "⌥" }
        if f.contains(.shift) { s += "⇧" }
        if f.contains(.command) { s += "⌘" }
        if let special {
            s += special
        } else if let c = charactersIgnoringModifiers?.uppercased(), let first = c.unicodeScalars.first, !CharacterSet.controlCharacters.contains(first) {
            s += String(c.prefix(1))
        } else {
            s += "key\(keyCode)"
        }
        return s
    }
}
#endif
