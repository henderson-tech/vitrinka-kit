#if DEBUG
import AppKit
import SwiftUI

/// Views and windows that never appear in a keyframe.
///
/// A private view's frame is painted black on the captured image before it
/// is encoded. `NSSecureTextField` (and SwiftUI `SecureField`, which is one)
/// is private automatically. If a registered private view on a captured
/// window has no usable frame, the whole frame is dropped (fail closed).
@MainActor
final class PrivateRegistry {
    static let shared = PrivateRegistry()

    private let views = NSHashTable<NSView>.weakObjects()
    private let windows = NSHashTable<NSWindow>.weakObjects()

    func contains(_ v: NSView) -> Bool { views.contains(v) }

    func set(_ v: NSView, private isPrivate: Bool) {
        if isPrivate { views.add(v) } else { views.remove(v) }
    }

    func containsWindow(_ w: NSWindow) -> Bool { windows.contains(w) }

    func setWindow(_ w: NSWindow, private isPrivate: Bool) {
        if isPrivate { windows.add(w) } else { windows.remove(w) }
    }

    /// The private rects on these windows in global top-left (CG) points, or
    /// nil when one cannot be resolved (the caller drops the frame).
    func privateRects(on targets: [NSWindow]) -> [CGRect]? {
        var out: [CGRect] = []
        for v in views.allObjects {
            guard let w = v.window, targets.contains(where: { $0 === w }) else { continue }
            if v.isHiddenOrHasHiddenAncestor { continue }
            guard let r = Self.globalRect(of: v, in: w) else { return nil }
            if !r.isEmpty { out.append(r) }
        }
        for w in targets {
            guard let root = w.contentView?.superview ?? w.contentView else { continue }
            var secure: [NSView] = []
            Self.collectSecureFields(root, into: &secure)
            for v in secure where !v.isHiddenOrHasHiddenAncestor {
                guard let r = Self.globalRect(of: v, in: w) else { return nil }
                if !r.isEmpty { out.append(r) }
            }
        }
        return out
    }

    private static func collectSecureFields(_ v: NSView, into out: inout [NSView]) {
        if v is NSSecureTextField {
            out.append(v)
            return
        }
        for s in v.subviews { collectSecureFields(s, into: &out) }
    }

    /// A view's frame in global top-left screen points; nil if not finite.
    static func globalRect(of v: NSView, in w: NSWindow) -> CGRect? {
        let inWindow = v.convert(v.bounds, to: nil)
        let screen = w.convertToScreen(inWindow)
        guard screen.origin.x.isFinite, screen.origin.y.isFinite, screen.width.isFinite, screen.height.isFinite else { return nil }
        return ScreenGeometry.toCG(screen)
    }
}

/// AppKit screen coordinates (bottom-left origin) ↔ CoreGraphics global
/// coordinates (top-left origin of the primary display), which
/// ScreenCaptureKit uses.
enum ScreenGeometry {
    @MainActor static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.maxY ?? 0
    }

    @MainActor static func toCG(_ r: NSRect) -> CGRect {
        CGRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height)
    }

    @MainActor static func toCG(_ p: NSPoint) -> CGPoint {
        CGPoint(x: p.x, y: primaryHeight - p.y)
    }

    /// The inverse: a top-left global (CG / accessibility attribute) rect →
    /// AppKit screen coordinates.
    @MainActor static func fromCG(_ r: CGRect) -> NSRect {
        NSRect(x: r.minX, y: primaryHeight - r.maxY, width: r.width, height: r.height)
    }
}

// MARK: - SwiftUI markers

/// A zero-interaction background view that registers its frame as private.
struct PrivateMarker: NSViewRepresentable {
    let isPrivate: Bool

    func makeNSView(context: Context) -> MarkerView {
        let v = MarkerView()
        PrivateRegistry.shared.set(v, private: isPrivate)
        return v
    }

    func updateNSView(_ v: MarkerView, context: Context) {
        PrivateRegistry.shared.set(v, private: isPrivate)
    }
}

/// A background view whose presence in a window sets that lane's route.
struct RouteMarker: NSViewRepresentable {
    let route: String

    func makeNSView(context: Context) -> RouteMarkerView {
        let v = RouteMarkerView()
        v.route = route
        return v
    }

    func updateNSView(_ v: RouteMarkerView, context: Context) {
        if v.route != route {
            v.route = route
            RouteRegistry.shared.changed(v)
        }
    }
}

class MarkerView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class RouteMarkerView: MarkerView {
    var route = ""

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        RouteRegistry.shared.changed(self)
    }
}

/// Routes per window lane: the host's `setRoute` sets a base, and the most
/// recently attached `.vitrinkaRoute` marker on screen wins over it.
@MainActor
final class RouteRegistry {
    static let shared = RouteRegistry()

    private struct Entry {
        weak var view: RouteMarkerView?
        weak var lane: NSWindow?
        var order: Int
    }

    private var markers: [ObjectIdentifier: Entry] = [:]
    private var base: [Int: String] = [:]
    private var counter = 0
    /// Called with the lane window whose route changed.
    var onChange: ((NSWindow) -> Void)?

    private var pendingLanes: [NSWindow] = []
    private var notifyScheduled = false

    /// A marker appeared, changed its route or left its window. The lane is
    /// resolved a moment later: a sheet's content can reach its window before
    /// the sheet is attached to its parent.
    func changed(_ v: RouteMarkerView) {
        let id = ObjectIdentifier(v)
        if v.window != nil {
            if markers[id] == nil {
                counter += 1
                markers[id] = Entry(view: v, lane: nil, order: counter)
            }
        } else if let e = markers.removeValue(forKey: id), let lane = e.lane {
            pendingLanes.append(lane)
        }
        guard !notifyScheduled else { return }
        notifyScheduled = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 60_000_000)
            self.flushNotifications()
        }
    }

    private func flushNotifications() {
        notifyScheduled = false
        var lanes = pendingLanes
        pendingLanes = []
        for (id, e) in markers {
            guard let v = e.view, let w = v.window else {
                markers[id] = nil
                continue
            }
            let lane = Lanes.laneWindow(of: w)
            markers[id]?.lane = lane
            lanes.append(lane)
        }
        var seen = Set<ObjectIdentifier>()
        for lane in lanes where seen.insert(ObjectIdentifier(lane)).inserted {
            onChange?(lane)
        }
    }

    func setBase(_ route: String, for laneWindow: NSWindow) {
        base[laneWindow.windowNumber] = route
    }

    func route(for laneWindow: NSWindow) -> String {
        var best: (order: Int, route: String)?
        for (id, e) in markers {
            guard let v = e.view, let w = v.window else {
                markers[id] = nil
                continue
            }
            guard Lanes.laneWindow(of: w) === laneWindow else { continue }
            if best.map({ e.order > $0.order }) ?? true { best = (e.order, v.route) }
        }
        return best?.route ?? base[laneWindow.windowNumber] ?? ""
    }
}
#endif
