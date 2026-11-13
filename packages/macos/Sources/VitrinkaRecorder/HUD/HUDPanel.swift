#if DEBUG
import AppKit
import Combine
import SwiftUI

/// The HUD window: a floating, non-activating panel. Clicking it does not
/// activate the app or steal the key window; it becomes key only for the
/// note field. It is never in a keyframe (captures list window ids
/// explicitly) and the click and key lanes ignore it.
final class HUDPanel: NSPanel, RecorderChromeWindow {
    init(content: NSView) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 320, height: 44),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        becomesKeyOnlyIfNeeded = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        isMovableByWindowBackground = true
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isReleasedWhenClosed = false
        title = "vitrinka recorder"
        contentView = content
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

/// Places the HUD and keeps its top-right corner where it was when the
/// content grows or shrinks.
@MainActor
final class HUDController {
    let model: HUDModel
    let panel: HUDPanel
    private let hosting: NSHostingView<HUDView>
    private var anchor: NSPoint?
    private var observers: [NSObjectProtocol] = []
    private var changes: AnyCancellable?
    private var fitting = false
    private weak var previousKey: NSWindow?

    init(model: HUDModel) {
        self.model = model
        hosting = NSHostingView(rootView: HUDView(model: model))
        hosting.sizingOptions = [.intrinsicContentSize]
        panel = HUDPanel(content: hosting)
        model.onWantsKey = { [weak self] wants in self?.wantsKey(wants) }
        // Refit after every model change, once SwiftUI has laid it out.
        changes = model.objectWillChange.merge(with: model.status.objectWillChange).sink { [weak self] _ in
            Task { @MainActor in self?.fit() }
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: panel, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.fitting else { return }
                self.anchor = NSPoint(x: self.panel.frame.maxX, y: self.panel.frame.maxY)
            }
        })
    }

    func show() {
        if anchor == nil, let screen = NSScreen.main ?? NSScreen.screens.first {
            let v = screen.visibleFrame
            anchor = NSPoint(x: v.maxX - 16, y: v.maxY - 16)
        }
        fit()
        panel.orderFrontRegardless()
    }

    /// Size the panel to its content, pinned at the top-right anchor.
    func fit() {
        let size = hosting.fittingSize
        guard size.width > 0, size.height > 0 else { return }
        let a = anchor ?? NSPoint(x: panel.frame.maxX, y: panel.frame.maxY)
        let frame = NSRect(x: a.x - size.width, y: a.y - size.height, width: size.width, height: size.height)
        anchor = a
        if frame != panel.frame {
            fitting = true
            panel.setFrame(frame, display: true)
            fitting = false
        }
    }

    private func wantsKey(_ wants: Bool) {
        if wants {
            if let k = NSApp.keyWindow, !(k is RecorderChromeWindow) { previousKey = k }
            NSApp.activate()
            panel.makeKeyAndOrderFront(nil)
        } else {
            panel.resignKey()
            previousKey?.makeKeyAndOrderFront(nil)
        }
    }
}
#endif
