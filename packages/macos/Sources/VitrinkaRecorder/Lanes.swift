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

/// What a click or a key landed on, from in-process accessibility: no
/// Accessibility permission is involved, these are calls on the app's own
/// objects.
struct ElementLabel: Equatable {
    var text: String?
    var selector: String?
    /// The element's frame, AppKit screen coordinates.
    var frame: NSRect?
}

@MainActor
enum ElementLabels {
    static let maxHops = 12
    static let cap = 120

    /// Hit-test the window's accessibility tree at a screen point and walk up
    /// to the first element with an identifier, label or title. Falls back
    /// to the AppKit view under the point.
    static func label(in window: NSWindow, screenPoint: NSPoint) -> ElementLabel {
        var best: ElementLabel?
        if let root = window.contentView, let hit = root.accessibilityHitTest(screenPoint), let found = walk(hit) {
            if found.text != nil { return found }
            best = found
        }
        let p = window.convertPoint(fromScreen: screenPoint)
        if let root = window.contentView?.superview ?? window.contentView, let v = root.hitTest(root.convert(p, from: nil)),
           let found = viewWalk(v, in: window)
        {
            if found.text != nil || best == nil { return found }
        }
        return best ?? ElementLabel(text: nil, selector: nil, frame: nil)
    }

    /// The AppKit fallback, for when the accessibility tree is not built (no
    /// assistive client has asked yet) or names nothing: the view under the
    /// point and its superviews. A control's title counts as a label; a text
    /// field's value is never read.
    static func viewWalk(_ start: NSView, in window: NSWindow) -> ElementLabel? {
        var view: NSView? = start
        var hops = 0
        while let v = view, hops < maxHops, !(v is NSClipView && hops > 3) {
            let id = usableIdentifier(v.identifier?.rawValue) ?? usableIdentifier(v.accessibilityIdentifier())
            let label = nonEmpty(v.accessibilityLabel())
            let title = (v as? NSButton).flatMap { nonEmpty($0.title) } ?? nonEmpty(v.accessibilityTitle())
            if id != nil || label != nil || title != nil {
                let role = roleName(v)
                let frame = window.convertToScreen(v.convert(v.bounds, to: nil))
                return ElementLabel(text: id ?? label ?? title, selector: id.map { "\(role)#\($0)" } ?? role, frame: frame)
            }
            hops += 1
            view = v.superview
        }
        return nil
    }

    static func roleName(_ v: NSView) -> String {
        if let r = v.accessibilityRole()?.rawValue, r != NSAccessibility.Role.unknown.rawValue { return r }
        switch v {
        case is NSPopUpButton: return NSAccessibility.Role.popUpButton.rawValue
        case is NSButton: return NSAccessibility.Role.button.rawValue
        case is NSSegmentedControl: return NSAccessibility.Role.radioGroup.rawValue
        case is NSSlider: return NSAccessibility.Role.slider.rawValue
        case let t as NSTextField: return t.isEditable ? NSAccessibility.Role.textField.rawValue : NSAccessibility.Role.staticText.rawValue
        case is NSTableView: return NSAccessibility.Role.table.rawValue
        default: return String(describing: type(of: v))
        }
    }

    /// The label of a focused view (the key lane's `target`).
    static func label(of responder: NSResponder?) -> ElementLabel? {
        var r: NSResponder? = responder
        // A field editor stands in for its text field.
        if let tv = r as? NSTextView, tv.isFieldEditor, let owner = tv.delegate as? NSResponder { r = owner }
        guard let element = r else { return nil }
        return walk(element)
    }

    /// Walk up from the hit element. The first element with an identifier,
    /// label or title is the anchor (an AppKit cell, a SwiftUI node); up to
    /// two ancestors above it may still contribute an identifier (an NSButton
    /// carries the identifier its cell lacks). The preference order holds
    /// across the walk, as in Expo's press labels: identifier, then label,
    /// then title.
    private static func walk(_ start: Any) -> ElementLabel? {
        var node: Any? = start
        var id: String?
        var label: String?
        var title: String?
        var role: String?
        var frame: NSRect?
        var anchor: Int?
        var hops = 0
        while let n = node, hops < maxHops {
            guard let el = n as? NSAccessibilityProtocol else { break }
            let r = el.accessibilityRole()?.rawValue
            if r == NSAccessibility.Role.window.rawValue || r == NSAccessibility.Role.application.rawValue { break }
            if role == nil, let r, r != NSAccessibility.Role.unknown.rawValue, r != NSAccessibility.Role.group.rawValue {
                role = r
                let f = el.accessibilityFrame()
                if !f.isEmpty { frame = f }
            }
            if id == nil { id = usableIdentifier(el.accessibilityIdentifier()) }
            if label == nil { label = nonEmpty(el.accessibilityLabel()) }
            if title == nil { title = nonEmpty(el.accessibilityTitle()) }
            if anchor == nil, id != nil || label != nil || title != nil {
                anchor = hops
                if frame == nil {
                    let f = el.accessibilityFrame()
                    if !f.isEmpty { frame = f }
                }
            }
            if let a = anchor, id != nil && role != nil || hops >= a + 2 { break }
            hops += 1
            node = el.accessibilityParent()
        }
        guard anchor != nil || role != nil else { return nil }
        let r = role ?? "AXElement"
        return ElementLabel(text: id ?? label ?? title, selector: id.map { "\(r)#\($0)" } ?? r, frame: frame)
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    /// AppKit's generated identifiers (`_NS:123`) say nothing.
    nonisolated static func usableIdentifier(_ id: String?) -> String? {
        guard let id = id?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty, !id.hasPrefix("_NS:") else { return nil }
        return id
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
