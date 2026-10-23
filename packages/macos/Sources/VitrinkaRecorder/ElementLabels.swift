#if DEBUG
import AppKit

/// What a click or a key landed on, from in-process accessibility: calls on
/// the app's own objects, no Accessibility permission involved.
struct ElementLabel: Equatable {
    /// A human label (accessibility label, title, a row's text), else the
    /// identifier. Never a text field's value.
    var text: String?
    /// `role#identifier`, or the role alone.
    var selector: String?
    /// The element's frame, AppKit screen coordinates.
    var frame: NSRect?
}

/// SwiftUI builds its accessibility tree only while an assistive client is
/// active; without one, an in-process hit test on a SwiftUI window stops at
/// the hosting view and a click on a SwiftUI button has no name. While a
/// recording runs (and `activatesAccessibilityTree` is on, the default), the
/// recorder marks its own app the way an assistive client does
/// (`AXEnhancedUserInterface` on the application element), and Stop restores
/// the previous value. It changes nothing outside the process, but like
/// VoiceOver it can change how the app animates windows.
@MainActor
enum AccessibilityTree {
    private static var setByUs = false
    private static let attribute = "AXEnhancedUserInterface"

    static func activate() {
        guard !setByUs else { return }
        let app = NSApplication.shared
        if (AXRead.legacy(app, attribute) as? NSNumber)?.boolValue == true { return }
        guard AXRead.setLegacy(app, attribute, NSNumber(value: true)) else { return }
        setByUs = true
    }

    static func deactivate() {
        guard setByUs else { return }
        _ = AXRead.setLegacy(NSApplication.shared, attribute, NSNumber(value: false))
        setByUs = false
    }
}

/// Reads an accessibility element through the NSAccessibility protocol, and
/// through the attribute API where the protocol answers nothing (AppKit's
/// own table rows and cells answer only there).
@MainActor
enum AXRead {
    private static let getSel = NSSelectorFromString("accessibilityAttributeValue:")
    private static let setSel = NSSelectorFromString("accessibilitySetValue:forAttribute:")

    static func legacy(_ element: Any, _ attribute: String) -> Any? {
        let o = element as AnyObject
        guard o.responds(to: getSel) else { return nil }
        return o.perform(getSel, with: attribute)?.takeUnretainedValue()
    }

    static func setLegacy(_ element: Any, _ attribute: String, _ value: Any) -> Bool {
        let o = element as AnyObject
        guard o.responds(to: setSel) else { return false }
        _ = o.perform(setSel, with: value, with: attribute)
        return true
    }

    private static func string(_ v: Any?) -> String? {
        guard let s = (v as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }

    /// The getter by dynamic dispatch: SwiftUI's accessibility nodes answer
    /// the NSAccessibility selectors without declaring the protocol, so the
    /// protocol cast fails on them. Guarded by `responds(to:)`, because KVC
    /// on a missing key raises.
    static func dynamic(_ e: Any, _ getter: String) -> Any? {
        guard let o = e as? NSObject, o.responds(to: NSSelectorFromString(getter)) else { return nil }
        return o.value(forKey: getter)
    }

    // Each read: the protocol, then dynamic dispatch, then the attribute API.

    static func role(_ e: Any) -> String? {
        string((e as? NSAccessibilityProtocol)?.accessibilityRole()?.rawValue) ?? string(dynamic(e, "accessibilityRole")) ?? string(legacy(e, "AXRole"))
    }

    static func subrole(_ e: Any) -> String? {
        string((e as? NSAccessibilityProtocol)?.accessibilitySubrole()?.rawValue) ?? string(dynamic(e, "accessibilitySubrole"))
            ?? string(legacy(e, "AXSubrole"))
    }

    /// The accessibility identifier, else an AppKit view's own `identifier`
    /// (AppKit does not always mirror it), never SwiftUI's plumbing ids.
    static func identifier(_ e: Any) -> String? {
        if let s = string((e as? NSAccessibilityProtocol)?.accessibilityIdentifier()) ?? string(dynamic(e, "accessibilityIdentifier"))
            ?? string(legacy(e, "AXIdentifier"))
        {
            return s
        }
        // An AppKit control answers through its cell.
        guard let v = (e as? NSView) ?? (e as? NSCell)?.controlView, !NSStringFromClass(type(of: v)).contains("SwiftUI") else { return nil }
        return string(v.identifier?.rawValue)
    }

    static func label(_ e: Any) -> String? {
        string((e as? NSAccessibilityProtocol)?.accessibilityLabel()) ?? string(dynamic(e, "accessibilityLabel")) ?? string(legacy(e, "AXDescription"))
    }

    static func title(_ e: Any) -> String? {
        string((e as? NSAccessibilityProtocol)?.accessibilityTitle()) ?? string(dynamic(e, "accessibilityTitle")) ?? string(legacy(e, "AXTitle"))
    }

    /// The value as text. Only ever read for static text.
    static func textValue(_ e: Any) -> String? {
        string((e as? NSAccessibilityProtocol)?.accessibilityValue()) ?? string(dynamic(e, "accessibilityValue")) ?? string(legacy(e, "AXValue"))
    }

    static func parent(_ e: Any) -> Any? {
        (e as? NSAccessibilityProtocol)?.accessibilityParent() ?? dynamic(e, "accessibilityParent") ?? legacy(e, "AXParent")
    }

    static func children(_ e: Any) -> [Any] {
        if let c = (e as? NSAccessibilityProtocol)?.accessibilityChildren(), !c.isEmpty { return c }
        if let c = dynamic(e, "accessibilityChildren") as? [Any], !c.isEmpty { return c }
        return (legacy(e, "AXChildren") as? [Any]) ?? []
    }

    /// AppKit screen coordinates; nil when empty.
    static func frame(_ e: Any) -> NSRect? {
        if let f = (e as? NSAccessibilityProtocol)?.accessibilityFrame(), !f.isEmpty { return f }
        if let f = (dynamic(e, "accessibilityFrame") as? NSValue)?.rectValue, !f.isEmpty { return f }
        guard let p = (legacy(e, "AXPosition") as? NSValue)?.pointValue, let s = (legacy(e, "AXSize") as? NSValue)?.sizeValue,
              s.width > 0, s.height > 0
        else { return nil }
        // The attribute API answers in top-left global coordinates.
        return NSRect(x: p.x, y: ScreenGeometry.primaryHeight - p.y - s.height, width: s.width, height: s.height)
    }
}

@MainActor
enum ElementLabels {
    static let maxHops = 12

    /// Roles that name what a click acted on.
    static let controlRoles: Set<String> = [
        "AXButton", "AXCheckBox", "AXRadioButton", "AXLink", "AXMenuItem", "AXMenuButton", "AXMenuBarItem",
        "AXPopUpButton", "AXComboBox", "AXTextField", "AXTextArea", "AXSlider", "AXIncrementor",
        "AXDisclosureTriangle", "AXColorWell", "AXDateTimeArea", "AXRow", "AXCell",
    ]
    static let rowRoles: Set<String> = ["AXRow", "AXCell"]
    static let textInputRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]
    /// Identifiers SwiftUI puts on its own AppKit plumbing.
    nonisolated static let internalIdentifiers: Set<String> = ["ListCell", "ListColumn", "ListRow"]

    /// Hit-test the window's accessibility tree at a screen point, descend
    /// to the deepest element under it, and resolve the control it belongs
    /// to. Falls back to the AppKit view under the point.
    static func label(in window: NSWindow, screenPoint: NSPoint) -> ElementLabel {
        var best: ElementLabel?
        if let root = window.contentView, let hit = root.accessibilityHitTest(screenPoint) {
            let deepest = descend(from: hit, to: screenPoint)
            if let found = resolve(from: deepest) {
                if found.text != nil { return found }
                best = found
            }
        }
        let p = window.convertPoint(fromScreen: screenPoint)
        if let root = window.contentView?.superview ?? window.contentView, let v = root.hitTest(root.convert(p, from: nil)),
           let found = viewWalk(v, in: window)
        {
            if found.text != nil || best == nil { return found }
        }
        return best ?? ElementLabel(text: nil, selector: nil, frame: nil)
    }

    /// The label of a focused view (the key lane's `target`).
    static func label(of responder: NSResponder?) -> ElementLabel? {
        var r: NSResponder? = responder
        // A field editor stands in for its text field.
        if let tv = r as? NSTextView, tv.isFieldEditor, let owner = tv.delegate as? NSResponder { r = owner }
        guard let element = r else { return nil }
        return resolve(from: element)
    }

    /// A hit test may stop at a container (a hosting view answers for its
    /// whole tree). Walk down to the smallest descendant whose frame holds
    /// the point.
    static func descend(from start: Any, to point: NSPoint) -> Any {
        var node = start
        var visited = 0
        for _ in 0 ..< maxHops {
            var next: (Any, CGFloat)?
            for c in AXRead.children(node) {
                visited += 1
                if visited > 2000 { return node }
                guard let f = AXRead.frame(c), f.contains(point) else { continue }
                let area = f.width * f.height
                if next.map({ area < $0.1 }) ?? true { next = (c, area) }
            }
            guard let n = next else { break }
            node = n.0
        }
        return node
    }

    /// Walk up to the first control (button, checkbox, row, text field…)
    /// that carries a name. Text is the human label first (label, title, a
    /// row's own text), the identifier only when there is nothing else;
    /// the selector is `role#identifier`. A text field's value is never read.
    static func resolve(from start: Any) -> ElementLabel? {
        var node: Any? = start
        var bareControl: ElementLabel?
        var named: ElementLabel?
        for _ in 0 ..< maxHops {
            guard let n = node else { break }
            let role = AXRead.role(n)
            if role == "AXWindow" || role == "AXApplication" { break }
            let id = usableIdentifier(AXRead.identifier(n))
            let human = AXRead.label(n) ?? AXRead.title(n)
            if let role, controlRoles.contains(role) {
                let text = human ?? (rowRoles.contains(role) ? childLabel(of: n) : nil)
                let selector = id.map { "\(role)#\($0)" } ?? role
                if text != nil || id != nil {
                    return ElementLabel(text: text ?? id, selector: selector, frame: AXRead.frame(n))
                }
                if bareControl == nil { bareControl = ElementLabel(text: nil, selector: selector, frame: AXRead.frame(n)) }
            } else if named == nil, let shown = human ?? (role == "AXStaticText" ? AXRead.textValue(n) : nil) {
                named = ElementLabel(text: shown, selector: role ?? "AXElement", frame: AXRead.frame(n))
            }
            node = AXRead.parent(n)
        }
        if let bareControl {
            return named.map { ElementLabel(text: $0.text, selector: bareControl.selector, frame: bareControl.frame) } ?? bareControl
        }
        return named
    }

    /// The text a row or cell shows: its first static text, or the label of
    /// its first checkbox or button. Text fields are skipped (their value is
    /// typed content).
    static func childLabel(of element: Any) -> String? {
        var queue: [(Any, Int)] = AXRead.children(element).map { ($0, 1) }
        var seen = 0
        while !queue.isEmpty, seen < 64 {
            let (n, depth) = queue.removeFirst()
            seen += 1
            let role = AXRead.role(n) ?? ""
            if textInputRoles.contains(role) || AXRead.subrole(n) == "AXSecureTextField" { continue }
            if role == "AXStaticText", let t = AXRead.textValue(n) ?? AXRead.label(n) ?? AXRead.title(n) { return t }
            if role == "AXCheckBox" || role == "AXButton" || role == "AXRadioButton",
               let t = AXRead.label(n) ?? AXRead.title(n)
            {
                return t
            }
            if depth < 4 { queue.append(contentsOf: AXRead.children(n).map { ($0, depth + 1) }) }
        }
        return nil
    }

    /// The AppKit fallback, for when the accessibility tree names nothing:
    /// the view under the point and its superviews. A control's title counts
    /// as a label; a text field's value is never read.
    static func viewWalk(_ start: NSView, in window: NSWindow) -> ElementLabel? {
        var view: NSView? = start
        var hops = 0
        while let v = view, hops < maxHops {
            let swiftUIPlumbing = NSStringFromClass(type(of: v)).contains("SwiftUI")
            let id = swiftUIPlumbing ? nil : usableIdentifier(v.identifier?.rawValue) ?? usableIdentifier(v.accessibilityIdentifier())
            let label = nonEmpty(v.accessibilityLabel())
            let title = (v as? NSButton).flatMap { nonEmpty($0.title) } ?? nonEmpty(v.accessibilityTitle())
            if id != nil || label != nil || title != nil {
                let role = roleName(v)
                let frame = window.convertToScreen(v.convert(v.bounds, to: nil))
                return ElementLabel(text: label ?? title ?? id, selector: id.map { "\(role)#\($0)" } ?? role, frame: frame)
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

    static func nonEmpty(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }

    /// AppKit's generated identifiers (`_NS:123`) and SwiftUI's own plumbing
    /// identifiers say nothing.
    nonisolated static func usableIdentifier(_ id: String?) -> String? {
        guard let id = id?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty, !id.hasPrefix("_NS:"),
              !internalIdentifiers.contains(id)
        else { return nil }
        return id
    }
}
#endif
