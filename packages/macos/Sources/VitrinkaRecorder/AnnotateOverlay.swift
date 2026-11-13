#if DEBUG
import AppKit

/// Region annotate (⌥⇧A): a transparent panel over the window where the
/// tester drags a marquee, then types what is wrong. The keyframe was taken
/// BEFORE this panel appeared, and the panel is never captured, so the frame
/// shows the clean pixels the rect refers to.
final class AnnotateOverlay: NSPanel, RecorderChromeWindow {
    private let marquee: MarqueeView

    /// `done` gets the note text and the rect in AppKit screen coordinates.
    init(over frame: NSRect, level: NSWindow.Level, done: @escaping (String, NSRect) -> Void, cancel: @escaping () -> Void) {
        marquee = MarqueeView(frame: NSRect(origin: .zero, size: frame.size))
        super.init(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        self.level = NSWindow.Level(rawValue: level.rawValue + 1)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isReleasedWhenClosed = false
        ignoresMouseEvents = false
        collectionBehavior = [.fullScreenAuxiliary, .ignoresCycle]
        contentView = marquee
        marquee.onDone = { [weak self] text, rect in
            guard let self else { return }
            let screen = self.convertToScreen(rect)
            self.close()
            done(text, screen)
        }
        marquee.onCancel = { [weak self] in
            self?.close()
            cancel()
        }
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    func present() {
        NSApp.activate()
        makeKeyAndOrderFront(nil)
        makeFirstResponder(marquee)
    }
}

final class MarqueeView: NSView, NSTextFieldDelegate {
    var onDone: (String, NSRect) -> Void = { _, _ in }
    var onCancel: () -> Void = {}

    private var anchor: NSPoint?
    private var selection: NSRect?
    private var composer: NSTextField?
    private var hint: NSTextField?

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { false }

    override init(frame: NSRect) {
        super.init(frame: frame)
        let h = NSTextField(labelWithString: "Drag around what is wrong · Esc cancels")
        h.font = .systemFont(ofSize: 12, weight: .medium)
        h.textColor = .white
        h.drawsBackground = true
        h.backgroundColor = NSColor.black.withAlphaComponent(0.6)
        h.sizeToFit()
        h.frame.origin = NSPoint(x: (frame.width - h.frame.width) / 2, y: frame.height - h.frame.height - 12)
        h.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin]
        addSubview(h)
        hint = h
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .crosshair)
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.18).setFill()
        bounds.fill()
        guard let s = selection else { return }
        NSColor.clear.setFill()
        s.fill(using: .copy)
        NSColor.controlAccentColor.setStroke()
        let path = NSBezierPath(rect: s.insetBy(dx: 1, dy: 1))
        path.lineWidth = 2
        path.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        composer?.removeFromSuperview()
        composer = nil
        anchor = convert(event.locationInWindow, from: nil)
        selection = nil
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let a = anchor else { return }
        let p = convert(event.locationInWindow, from: nil)
        selection = NSRect(x: min(a.x, p.x), y: min(a.y, p.y), width: abs(p.x - a.x), height: abs(p.y - a.y)).intersection(bounds)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        anchor = nil
        guard let s = selection, s.width >= 4, s.height >= 4 else {
            selection = nil
            needsDisplay = true
            return
        }
        hint?.isHidden = true
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.placeholderString = "What is wrong here? Return saves, Esc cancels"
        field.delegate = self
        field.target = self
        field.action = #selector(submit(_:))
        var origin = NSPoint(x: s.minX, y: s.minY - field.frame.height - 6)
        if origin.y < 4 { origin.y = min(s.maxY + 6, bounds.height - field.frame.height - 4) }
        origin.x = max(4, min(origin.x, bounds.width - field.frame.width - 4))
        field.frame.origin = origin
        addSubview(field)
        composer = field
        window?.makeFirstResponder(field)
    }

    @objc private func submit(_ sender: NSTextField) {
        guard let s = selection else { return }
        onDone(sender.stringValue.trimmingCharacters(in: .whitespacesAndNewlines), s)
    }

    override func cancelOperation(_ sender: Any?) {
        onCancel()
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        if selector == #selector(NSResponder.cancelOperation(_:)) {
            onCancel()
            return true
        }
        return false
    }
}
#endif
