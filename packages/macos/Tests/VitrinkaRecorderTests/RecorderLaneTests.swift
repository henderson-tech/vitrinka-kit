import AppKit
import ImageIO
import SwiftUI
@testable import VitrinkaRecorder
import VitrinkaRecorderCore
import XCTest

final class LaneNamingTests: XCTestCase {
    func testSwiftUISceneIdentifiersAreTidied() {
        XCTAssertEqual(Lanes.tidy("main-AppWindow-1"), "main")
        XCTAssertEqual(Lanes.tidy("main-AppWindow-2"), "main-2")
        XCTAssertEqual(Lanes.tidy("com_apple_SwiftUI_Settings_window"), "settings")
        XCTAssertEqual(Lanes.tidy("SwiftUI.ModifiedContent<Demo.ContentView, SwiftUI._FrameLayout>-1-AppWindow-1"), "main")
        XCTAssertEqual(Lanes.tidy("Fan Control (beta)"), "fan-control-beta")
        XCTAssertEqual(Lanes.tidy("¿?"), "window")
    }

    func testLanePaths() {
        XCTAssertEqual(Lanes.path(lane: "main", route: ""), "/main")
        XCTAssertEqual(Lanes.path(lane: "main", route: "/items/"), "/main/items")
        XCTAssertEqual(Lanes.path(lane: "settings", route: "general"), "/settings/general")
    }
}

final class KeyLaneTests: XCTestCase {
    func testPlainTypingIsNeverRecorded() {
        XCTAssertNil(KeyCombos.combo(keyCode: 0, flags: [], charactersIgnoringModifiers: "a"))
        XCTAssertNil(KeyCombos.combo(keyCode: 0, flags: [.shift], charactersIgnoringModifiers: "a"))
        XCTAssertNil(KeyCombos.combo(keyCode: 0, flags: [.option], charactersIgnoringModifiers: "a"))
        XCTAssertNil(KeyCombos.combo(keyCode: 49, flags: [], charactersIgnoringModifiers: " "))
    }

    func testShortcutsAndSpecialKeys() {
        XCTAssertEqual(KeyCombos.combo(keyCode: 1, flags: [.command], charactersIgnoringModifiers: "s"), "⌘S")
        XCTAssertEqual(KeyCombos.combo(keyCode: 45, flags: [.command, .shift], charactersIgnoringModifiers: "n"), "⇧⌘N")
        XCTAssertEqual(KeyCombos.combo(keyCode: 8, flags: [.control], charactersIgnoringModifiers: "c"), "⌃C")
        XCTAssertEqual(KeyCombos.combo(keyCode: 36, flags: [], charactersIgnoringModifiers: "\r"), "↩")
        XCTAssertEqual(KeyCombos.combo(keyCode: 53, flags: [], charactersIgnoringModifiers: "\u{1b}"), "⎋")
        XCTAssertEqual(KeyCombos.combo(keyCode: 48, flags: [.shift], charactersIgnoringModifiers: "\t"), "⇧⇥")
        XCTAssertEqual(KeyCombos.combo(keyCode: 126, flags: [], charactersIgnoringModifiers: nil), "↑")
        XCTAssertEqual(KeyCombos.combo(keyCode: 51, flags: [.command], charactersIgnoringModifiers: nil), "⌘⌫")
    }

    func testRecorderChordsByPhysicalKey() {
        XCTAssertEqual(KeyCombos.chord(keyCode: 45, flags: [.option, .shift]), .note)
        XCTAssertEqual(KeyCombos.chord(keyCode: 0, flags: [.option, .shift]), .annotate)
        XCTAssertEqual(KeyCombos.chord(keyCode: 35, flags: [.option, .shift]), .pause)
        XCTAssertEqual(KeyCombos.chord(keyCode: 1, flags: [.option, .shift]), .stop)
        XCTAssertNil(KeyCombos.chord(keyCode: 1, flags: [.option, .shift, .command]))
        XCTAssertNil(KeyCombos.chord(keyCode: 1, flags: [.option]))
    }
}

final class ConsoleFilterTests: XCTestCase {
    let own = ConsoleLane.ownSubsystems(bundleID: "dev.example.app.debug", appID: "dev.example.app.debug")

    private func keep(_ subsystem: String, error: Bool = true, level: String = "error", text: String = "x",
                      _ filter: VitrinkaRecorderConfiguration.LogCapture = .errors) -> Bool
    {
        ConsoleLane.keep(subsystem: subsystem, isError: error, osLevel: level, text: text, filter: filter, own: own)
    }

    func testOwnSubsystemsDropABuildFlavour() {
        XCTAssertEqual(own, ["dev.example.app.debug", "dev.example.app"])
        XCTAssertEqual(ConsoleLane.ownSubsystems(bundleID: "dev.vitrinka.recorder-demo", appID: "dev.vitrinka.recorder-demo"), ["dev.vitrinka.recorder-demo"])
        XCTAssertEqual(ConsoleLane.ownSubsystems(bundleID: nil, appID: "dev.foltyn.genesis-fan-control.debug"),
                       ["dev.foltyn.genesis-fan-control.debug", "dev.foltyn.genesis-fan-control"])
    }

    func testErrorsTakeOnlyTheAppsOwnSubsystems() {
        XCTAssertTrue(keep("dev.example.app"))
        XCTAssertTrue(keep("dev.example.app.network"), "a subsystem under the app's own")
        XCTAssertTrue(keep("dev.example.app.debug"))
        XCTAssertFalse(keep("dev.example.application"), "a prefix only counts at a dot")
        XCTAssertFalse(keep("dev.example.app", error: false, level: "default"), "errors and faults only")
        XCTAssertFalse(keep("com.apple.network"))
        XCTAssertFalse(keep("dev.other.lib"))
        XCTAssertFalse(keep("dev.vitrinka.recorder", level: "fault"), "never the recorder's own")
        XCTAssertFalse(keep("dev.example.app", .off))
    }

    func testFrameworkLinesWithoutASubsystemStayOut() {
        // The noise of the first live run (CoreAudio, a cache): no subsystem.
        XCTAssertFalse(keep("", text: "HALC_ShellObject::SetPropertyData: call to the proxy failed"))
        XCTAssertFalse(keep("", text: "fopen failed for data file: errno = 2"))
        XCTAssertFalse(keep("", text: "Errors found! Invalidating cache..."))
        XCTAssertFalse(keep("", text: "pultik: poll failed", .all()), "all() does not open the unlabelled lines")
    }

    func testUnlabelledLinesNeedTheHostsPrefix() {
        let f = VitrinkaRecorderConfiguration.LogCapture.errors(unlabelledPrefixes: ["pultik:", ""])
        XCTAssertEqual(f.unlabelledPrefixes, ["pultik:"], "an empty prefix would match everything")
        XCTAssertTrue(keep("", error: false, level: "default", text: "pultik: poll failed", f))
        XCTAssertFalse(keep("", error: false, level: "default", text: "HALC_ShellObject failed", f))
        XCTAssertFalse(keep("", error: false, level: "debug", text: "pultik: noisy", f))
    }

    func testAllAddsTheNonDebugLinesOfListedSubsystems() {
        let f = VitrinkaRecorderConfiguration.LogCapture.all(subsystems: ["dev.example.kit"])
        XCTAssertTrue(keep("dev.example.kit", error: false, level: "default", f))
        XCTAssertTrue(keep("dev.example.app", error: false, level: "info", f))
        XCTAssertFalse(keep("dev.example.kit", error: false, level: "debug", f))
        XCTAssertFalse(keep("dev.other", error: false, level: "default", f))
        let errorsToo = VitrinkaRecorderConfiguration.LogCapture.errors(subsystems: ["dev.example.kit"])
        XCTAssertTrue(keep("dev.example.kit", errorsToo))
        XCTAssertFalse(keep("dev.example.kit", error: false, level: "default", errorsToo))
    }
}

final class SessionTitleTests: XCTestCase {
    func testDefaultTitleIsTheAppNameAndLocalTime() {
        let at = Date(timeIntervalSince1970: 1_792_782_000) // 2026-10-23 19:00 UTC
        let title = RecorderRuntime.defaultTitle(displayName: "Recorder Demo", now: at,
                                                 locale: Locale(identifier: "en_US"), timeZone: TimeZone(identifier: "Europe/Prague")!)
        XCTAssertTrue(title.hasPrefix("Recorder Demo · Oct 23, 2026"), title)
        XCTAssertTrue(title.contains("9:00"), "local time (Prague), not UTC: \(title)")
    }
}

final class FrameEncoderTests: XCTestCase {
    private func whiteImage(_ w: Int, _ h: Int) -> CGImage {
        let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()!
    }

    private func decode(_ jpeg: Data) -> (CGImage, [UInt8]) {
        let src = CGImageSourceCreateWithData(jpeg as CFData, nil)!
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil)!
        var px = [UInt8](repeating: 0, count: img.width * img.height)
        let ctx = CGContext(data: &px, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: img.width,
                            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        return (img, px)
    }

    func testPrivateRectsArePaintedBlackBeforeEncoding() throws {
        let geo = CaptureGeometry(originCG: .zero, sizePoints: CGSize(width: 100, height: 50), scale: 2)
        // A private rect at (10,5) 20×10 points → pixels (20,10) 40×20, top-left origin.
        let mask = geo.pixelRect(CGRect(x: 10, y: 5, width: 20, height: 10))
        XCTAssertEqual(mask, CGRect(x: 20, y: 10, width: 40, height: 20))
        let frame = try FrameEncoder.encode(SendableImage(image: whiteImage(200, 100)), masks: [mask], geometry: geo, blurWidth: nil, capturedAt: Date(), fidelity: "window")
        XCTAssertEqual(frame.pixelWidth, 200)
        XCTAssertEqual(frame.jpeg.prefix(2), Data([0xFF, 0xD8]), "JPEG")
        let (img, px) = decode(frame.jpeg)
        func at(_ x: Int, _ y: Int) -> UInt8 { px[y * img.width + x] } // row 0 is the top
        XCTAssertLessThan(at(40, 20), 30, "inside the mask")
        XCTAssertGreaterThan(at(150, 80), 225, "outside the mask")
        XCTAssertGreaterThan(at(40, 60), 225, "below the mask")
    }

    func testBlurPolicyEncodes96PixelsWideAndRescalesGeometry() throws {
        let geo = CaptureGeometry(originCG: .zero, sizePoints: CGSize(width: 800, height: 400), scale: 2)
        let frame = try FrameEncoder.encode(SendableImage(image: whiteImage(1600, 800)), masks: [], geometry: geo, blurWidth: 96, capturedAt: Date(), fidelity: "window")
        XCTAssertEqual(frame.pixelWidth, 96)
        XCTAssertEqual(frame.pixelHeight, 48)
        XCTAssertEqual(frame.geometry.scale, 96.0 / 800.0, accuracy: 1e-9)
    }

    func testIdenticalFramesHashAlike() throws {
        let geo = CaptureGeometry(originCG: .zero, sizePoints: CGSize(width: 100, height: 50), scale: 1)
        let a = try FrameEncoder.encode(SendableImage(image: whiteImage(100, 50)), masks: [], geometry: geo, blurWidth: nil, capturedAt: Date(), fidelity: "window")
        let b = try FrameEncoder.encode(SendableImage(image: whiteImage(100, 50)), masks: [], geometry: geo, blurWidth: nil, capturedAt: Date(), fidelity: "window")
        let c = try FrameEncoder.encode(SendableImage(image: whiteImage(100, 50)), masks: [CGRect(x: 0, y: 0, width: 50, height: 50)], geometry: geo, blurWidth: nil, capturedAt: Date(), fidelity: "window")
        XCTAssertEqual(a.thumbHash, b.thumbHash)
        XCTAssertNotEqual(a.thumbHash, c.thumbHash)
    }
}

final class ConfigurationTests: XCTestCase {
    func testFromEnvironmentReadsTheURL() {
        setenv("VITRINKA_RECORDER_URL", "http://127.0.0.1:8097", 1)
        defer { unsetenv("VITRINKA_RECORDER_URL") }
        let c = VitrinkaRecorderConfiguration.fromEnvironment(appID: "dev.vitrinka.recorder-demo")
        XCTAssertEqual(c?.baseURL.absoluteString, "http://127.0.0.1:8097")
        XCTAssertEqual(c?.appID, "dev.vitrinka.recorder-demo")
    }

    func testFromEnvironmentRefusesANonHTTPURL() {
        setenv("VITRINKA_RECORDER_URL", "file:///etc/passwd", 1)
        defer { unsetenv("VITRINKA_RECORDER_URL") }
        if UserDefaults.standard.string(forKey: "VitrinkaRecorderURL") == nil {
            XCTAssertNil(VitrinkaRecorderConfiguration.fromEnvironment())
        }
    }
}

/// In-process labels. Offscreen windows, nothing is shown. In a test
/// process AppKit builds no accessibility tree, so these exercise the view
/// fallback and a SwiftUI spike that skips; `ElementResolveTests` covers the
/// accessibility walk with synthetic elements.
@MainActor
final class AccessibilityLabelSpikeTests: XCTestCase {
    private func window(with content: NSView) -> NSWindow {
        let w = NSWindow(contentRect: NSRect(x: 200, y: 200, width: 300, height: 200), styleMask: [.titled], backing: .buffered, defer: true)
        w.contentView = content
        w.contentView?.layoutSubtreeIfNeeded()
        return w
    }

    func testAppKitButtonIsLabelledByHitTest() throws {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 200))
        let button = NSButton(title: "Open settings", target: nil, action: nil)
        button.frame = NSRect(x: 50, y: 80, width: 160, height: 32)
        button.identifier = NSUserInterfaceItemIdentifier("open-settings")
        root.addSubview(button)
        let w = window(with: root)
        let center = w.convertPoint(toScreen: button.convert(NSPoint(x: button.bounds.midX, y: button.bounds.midY), to: nil))
        let label = ElementLabels.label(in: w, screenPoint: center)
        XCTAssertEqual(label.text, "Open settings", "the human label first")
        XCTAssertEqual(label.selector, "AXButton#open-settings", "the identifier rides in the selector")
        XCTAssertNotNil(label.frame)
    }

    func testSwiftUIButtonSpike() throws {
        let host = NSHostingView(rootView:
            VStack {
                Button("Approve") {}.accessibilityIdentifier("approve")
            }
            .frame(width: 300, height: 200)
        )
        host.frame = NSRect(x: 0, y: 0, width: 300, height: 200)
        let w = window(with: host)
        host.layoutSubtreeIfNeeded()
        var found: ElementLabel?
        // Walk a grid: the button's exact frame is SwiftUI's business.
        outer: for y in stride(from: 10.0, to: 200, by: 10) {
            for x in stride(from: 10.0, to: 300, by: 10) {
                let p = w.convertPoint(toScreen: host.convert(NSPoint(x: x, y: y), to: nil))
                let l = ElementLabels.label(in: w, screenPoint: p)
                if l.text == "approve" || l.text == "Approve" {
                    found = l
                    break outer
                }
            }
        }
        if let found {
            print("vitrinka AX spike: SwiftUI button resolved in-process: text=\(found.text ?? "-") selector=\(found.selector ?? "-")")
        } else {
            throw XCTSkip("SwiftUI exposed no accessibility element in an offscreen window; the live run decides (clicks fall back to coordinates)")
        }
    }
}

/// The accessibility walk on synthetic trees shaped like the ones SwiftUI
/// and AppKit expose while an assistive client is active.
@MainActor
final class ElementResolveTests: XCTestCase {
    private func el(_ role: NSAccessibility.Role, _ frame: NSRect = NSRect(x: 0, y: 0, width: 10, height: 10),
                    label: String? = nil, title: String? = nil, id: String? = nil, value: String? = nil,
                    subrole: NSAccessibility.Subrole? = nil, parent: NSAccessibilityElement? = nil) -> NSAccessibilityElement
    {
        let e = NSAccessibilityElement()
        e.setAccessibilityRole(role)
        e.setAccessibilityFrame(frame)
        if let label { e.setAccessibilityLabel(label) }
        if let title { e.setAccessibilityTitle(title) }
        if let id { e.setAccessibilityIdentifier(id) }
        if let value { e.setAccessibilityValue(value) }
        if let subrole { e.setAccessibilitySubrole(subrole) }
        if let parent {
            e.setAccessibilityParent(parent)
            parent.setAccessibilityChildren((parent.accessibilityChildren() ?? []) + [e])
        }
        return e
    }

    func testAButtonsTextChildResolvesToTheButton() {
        let root = el(.group)
        let button = el(.button, NSRect(x: 10, y: 10, width: 80, height: 24), label: "Add item", id: "add-item", parent: root)
        let text = el(.staticText, NSRect(x: 20, y: 14, width: 60, height: 16), value: "Add item", parent: button)
        let l = ElementLabels.resolve(from: text)
        XCTAssertEqual(l?.text, "Add item")
        XCTAssertEqual(l?.selector, "AXButton#add-item")
        XCTAssertEqual(l?.frame, NSRect(x: 10, y: 10, width: 80, height: 24))
    }

    func testAListRowIsNamedByItsCheckboxNotBySwiftUIsCellIdentifier() {
        let outline = el(.outline)
        let row = el(.row, NSRect(x: 0, y: 100, width: 300, height: 24), parent: outline)
        let cell = el(.cell, NSRect(x: 10, y: 100, width: 280, height: 24), id: "ListCell", parent: row)
        _ = el(.checkBox, NSRect(x: 12, y: 102, width: 200, height: 20), title: "Calibrate fan curve", value: "0", parent: cell)
        let l = ElementLabels.resolve(from: cell)
        XCTAssertEqual(l?.text, "Calibrate fan curve")
        XCTAssertEqual(l?.selector, "AXCell", "SwiftUI's ListCell identifier says nothing")
    }

    func testATextFieldIsNamedByItsLabelAndNeverByItsValue() {
        let root = el(.group)
        let field = el(.textField, label: "API password", value: "hunter2-typed", subrole: .secureTextField, parent: root)
        let l = ElementLabels.resolve(from: field)
        XCTAssertEqual(l?.text, "API password")
        XCTAssertEqual(l?.selector, "AXTextField")
        let row = el(.row, parent: root)
        _ = el(.textField, value: "typed in a row", parent: row)
        XCTAssertNil(ElementLabels.childLabel(of: row), "a row's text field value is typed content")
    }

    func testAnIconButtonWithoutANameKeepsItsRole() {
        let root = el(.group, label: "Toolbar")
        let button = el(.button, parent: root)
        let l = ElementLabels.resolve(from: button)
        XCTAssertEqual(l?.selector, "AXButton")
        XCTAssertEqual(l?.text, "Toolbar", "the nearest named container")
    }

    func testDescendFindsTheSmallestElementUnderThePoint() {
        let root = el(.group, NSRect(x: 0, y: 0, width: 400, height: 300))
        let panel = el(.group, NSRect(x: 0, y: 0, width: 400, height: 150), parent: root)
        let button = el(.button, NSRect(x: 20, y: 20, width: 100, height: 30), label: "Approve", id: "approve", parent: panel)
        _ = el(.button, NSRect(x: 200, y: 20, width: 100, height: 30), label: "Close", parent: panel)
        let hit = ElementLabels.descend(from: root, to: NSPoint(x: 50, y: 35))
        XCTAssertTrue((hit as AnyObject) === button)
        XCTAssertEqual(ElementLabels.resolve(from: hit)?.text, "Approve")
        XCTAssertEqual(ElementLabels.resolve(from: hit)?.selector, "AXButton#approve")
    }
}

final class ConsoleCollapserTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_792_782_000)

    private func line(_ text: String, at seconds: Double, category: String = "smc") -> ConsoleLine {
        ConsoleLine(date: t0.addingTimeInterval(seconds), level: "error", osLevel: "error", text: text,
                    subsystem: "dev.foltyn.genesis-fan-control", category: category)
    }

    func testRepeatsWithinAWindowAreSentOnceThenSummarised() {
        var c = ConsoleCollapser()
        var sent: [ConsoleLine] = []
        // The chatty line of the second live run, every 2 s with changing numbers.
        for i in 0 ..< 30 {
            sent += c.admit(line("Ghost cluster filter suppressed \(10 + i % 3) sensors: Tp01,Tp05", at: Double(i) * 2))
        }
        XCTAssertEqual(sent.count, 1, "the first copy only, within 60 s")
        XCTAssertNil(sent.first?.repeats)
        // The window (opened at 0 s) closes; the next poll sends the summary.
        sent = c.expire(now: t0.addingTimeInterval(61))
        XCTAssertEqual(sent.count, 1)
        XCTAssertEqual(sent.first?.repeats, 29, "the copies at 2…58 s")
        XCTAssertEqual(sent.first?.text, "Ghost cluster filter suppressed 10 sensors: Tp01,Tp05", "the first text")
        XCTAssertEqual(sent.first?.category, "smc")
        XCTAssertEqual(sent.first?.date, t0.addingTimeInterval(58), "at the last repeat")
        // Copies after the window closed open a new window: sent again once.
        let more = c.admit(line("Ghost cluster filter suppressed 11 sensors: Tp01,Tp05", at: 62))
        XCTAssertEqual(more.count, 1)
        XCTAssertNil(more.first?.repeats)
    }

    func testDifferentLinesAndCategoriesAreNotCollapsed() {
        var c = ConsoleCollapser()
        var sent = c.admit(line("payment API answered 502", at: 0))
        sent += c.admit(line("payment API answered 503", at: 1))  // the same after digit normalisation
        sent += c.admit(line("payment API answered 502", at: 2, category: "net"))
        sent += c.admit(line("disk full", at: 3))
        XCTAssertEqual(sent.map(\.text), ["payment API answered 502", "payment API answered 502", "disk full"])
        XCTAssertEqual(sent.map(\.category), ["smc", "net", "smc"])
    }

    func testStopDrainsOpenSummaries() {
        var c = ConsoleCollapser()
        _ = c.admit(line("retry 1", at: 0))
        _ = c.admit(line("retry 2", at: 1))
        _ = c.admit(line("retry 3", at: 2))
        _ = c.admit(line("alone", at: 3))
        let tail = c.drain()
        XCTAssertEqual(tail.count, 1, "only windows with repeats leave a summary")
        XCTAssertEqual(tail.first?.repeats, 2)
        XCTAssertEqual(tail.first?.text, "retry 1")
        XCTAssertTrue(c.drain().isEmpty)
    }

    func testTheSessionCapEndsWithOneMarker() {
        var c = ConsoleCollapser()
        var sent: [ConsoleLine] = []
        for i in 0 ..< 260 { sent += c.admit(line("distinct line \(String(UnicodeScalar(UInt8(65 + i % 26))))\(i / 26)x", at: Double(i) * 0.01, category: "c\(i)")) }
        XCTAssertEqual(sent.count, ConsoleCollapser.sessionCap + 1)
        XCTAssertEqual(sent.filter(\.capped).count, 1)
        XCTAssertEqual(sent.last?.capped, true)
        XCTAssertEqual(sent.last?.level, "log", "the marker is never a failure")
        XCTAssertTrue(c.admit(line("after the cap", at: 100, category: "z")).isEmpty)
        XCTAssertTrue(c.expire(now: t0.addingTimeInterval(500)).isEmpty)
    }
}

/// A stand-in for SwiftUI's private `AccessibilityNode`: it answers the
/// NSAccessibility selectors but does not declare NSAccessibilityProtocol,
/// has no `accessibilityTitle`, and its attribute API answers nothing — the
/// shape the second GUI run traced.
final class FakeSwiftUINode: NSObject {
    let role: String
    let label: String?
    let identifier: String
    let frame: NSRect
    let value: Any?
    weak var parent: AnyObject?
    var children: [Any] = []

    init(_ role: String, _ frame: NSRect, label: String? = nil, identifier: String = "", value: Any? = nil, parent: FakeSwiftUINode? = nil) {
        self.role = role
        self.label = label
        self.identifier = identifier
        self.frame = frame
        self.value = value
        super.init()
        if let parent {
            self.parent = parent
            parent.children.append(self)
        }
    }

    @objc func accessibilityRole() -> String? { role }
    @objc func accessibilityLabel() -> String? { label }
    @objc func accessibilityIdentifier() -> String { identifier }
    @objc func accessibilityFrame() -> NSRect { frame }
    @objc func accessibilityParent() -> Any? { parent }
    @objc func accessibilityChildren() -> [Any]? { children }
    @objc func accessibilityValue() -> Any? { value }
}

@MainActor
final class SwiftUINodeResolveTests: XCTestCase {
    func testTheFakeReproducesSwiftUIsNode() {
        let n = FakeSwiftUINode("AXButton", NSRect(x: 0, y: 0, width: 10, height: 10), label: "Open settings")
        XCTAssertFalse((n as Any) is NSAccessibilityProtocol, "the protocol cast fails, as on SwiftUI's node")
        XCTAssertFalse(n.responds(to: NSSelectorFromString("accessibilityTitle")))
        XCTAssertNil(AXRead.legacy(n, "AXRole"), "the attribute API answers nothing")
    }

    func testAButtonIsReadThroughDynamicDispatch() {
        let host = FakeSwiftUINode("AXGroup", NSRect(x: 3000, y: 1900, width: 600, height: 400))
        let button = FakeSwiftUINode("AXButton", NSRect(x: 3115, y: 2007, width: 109, height: 24), label: "Open settings", parent: host)
        XCTAssertEqual(AXRead.role(button), "AXButton")
        XCTAssertEqual(AXRead.label(button), "Open settings")
        XCTAssertNil(AXRead.title(button))
        XCTAssertNil(AXRead.identifier(button), "an empty identifier is none")
        XCTAssertEqual(AXRead.frame(button), NSRect(x: 3115, y: 2007, width: 109, height: 24))
        XCTAssertTrue((AXRead.parent(button) as AnyObject) === host)
        let l = ElementLabels.resolve(from: button)
        XCTAssertEqual(l?.text, "Open settings")
        XCTAssertEqual(l?.selector, "AXButton")
        XCTAssertEqual(l?.frame, NSRect(x: 3115, y: 2007, width: 109, height: 24))
    }

    func testTheWalkGoesUpThroughAccessibilityParent() {
        let host = FakeSwiftUINode("AXGroup", NSRect(x: 0, y: 0, width: 600, height: 400))
        let button = FakeSwiftUINode("AXButton", NSRect(x: 10, y: 10, width: 90, height: 24), label: "Add item", identifier: "add-item", parent: host)
        let text = FakeSwiftUINode("AXStaticText", NSRect(x: 20, y: 14, width: 60, height: 16), value: "Add item", parent: button)
        let l = ElementLabels.resolve(from: text)
        XCTAssertEqual(l?.text, "Add item")
        XCTAssertEqual(l?.selector, "AXButton#add-item")
    }

    func testARowIsNamedByItsCheckboxChild() {
        let outline = FakeSwiftUINode("AXOutline", NSRect(x: 0, y: 0, width: 300, height: 200))
        let row = FakeSwiftUINode("AXRow", NSRect(x: 0, y: 100, width: 300, height: 24), parent: outline)
        let cell = FakeSwiftUINode("AXCell", NSRect(x: 10, y: 100, width: 280, height: 24), identifier: "ListCell", parent: row)
        _ = FakeSwiftUINode("AXCheckBox", NSRect(x: 12, y: 102, width: 200, height: 20), label: "Calibrate fan curve", value: NSNumber(value: 0), parent: cell)
        let l = ElementLabels.resolve(from: cell)
        XCTAssertEqual(l?.text, "Calibrate fan curve")
        XCTAssertEqual(l?.selector, "AXCell")
    }

    func testDescendThroughDynamicChildren() {
        let host = FakeSwiftUINode("AXGroup", NSRect(x: 0, y: 0, width: 600, height: 400))
        let approve = FakeSwiftUINode("AXButton", NSRect(x: 400, y: 20, width: 80, height: 24), label: "Approve", identifier: "approve", parent: host)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 300, y: 20, width: 80, height: 24), label: "Close", parent: host)
        let hit = ElementLabels.descend(from: host, to: NSPoint(x: 420, y: 30))
        XCTAssertTrue((hit as AnyObject) === approve)
        XCTAssertEqual(ElementLabels.resolve(from: hit)?.selector, "AXButton#approve")
    }
}

/// A SwiftUI sheet on macOS 26: the click's window is the main window, and
/// the AXSheet is a child of the window element beside the content group.
@MainActor
final class SheetResolveTests: XCTestCase {
    private func tree() -> (window: FakeSwiftUINode, content: FakeSwiftUINode) {
        let window = FakeSwiftUINode("AXWindow", NSRect(x: 0, y: 0, width: 800, height: 600))
        let content = FakeSwiftUINode("AXGroup", NSRect(x: 0, y: 0, width: 800, height: 572), parent: window)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 20, y: 20, width: 100, height: 24), label: "Show details", identifier: "show-details", parent: content)
        let sheet = FakeSwiftUINode("AXSheet", NSRect(x: 220, y: 300, width: 360, height: 160), parent: window)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 400, y: 320, width: 70, height: 24), label: "Close", parent: sheet)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 480, y: 320, width: 80, height: 24), label: "Approve", identifier: "approve", parent: sheet)
        return (window, content)
    }

    func testAButtonInASheetIsFoundThroughTheWindowElement() {
        let (window, content) = tree()
        // The content view's hit test answers the hosting group itself, and
        // from there the sheet is out of reach (the session 11 gap).
        XCTAssertNil(ElementLabels.resolve(from: ElementLabels.descend(from: content, to: NSPoint(x: 420, y: 330))))
        let close = ElementLabels.resolve(inWindow: window, hits: [content], at: NSPoint(x: 420, y: 330))
        XCTAssertEqual(close?.text, "Close")
        XCTAssertEqual(close?.selector, "AXButton")
        let approve = ElementLabels.resolve(inWindow: window, hits: [content], at: NSPoint(x: 500, y: 330))
        XCTAssertEqual(approve?.text, "Approve")
        XCTAssertEqual(approve?.selector, "AXButton#approve")
    }

    func testOutsideTheSheetTheContentStillAnswers() {
        let (window, content) = tree()
        let l = ElementLabels.resolve(inWindow: window, hits: [content], at: NSPoint(x: 50, y: 30))
        XCTAssertEqual(l?.text, "Show details")
        XCTAssertEqual(l?.selector, "AXButton#show-details")
    }

    func testWithoutAnyHitTheWindowChildrenAreSearched() {
        let (window, _) = tree()
        XCTAssertEqual(ElementLabels.resolve(inWindow: window, hits: [], at: NSPoint(x: 420, y: 330))?.text, "Close")
        XCTAssertNil(ElementLabels.resolve(inWindow: window, hits: [], at: NSPoint(x: 700, y: 590)), "nothing named under the point")
    }
}

/// AppKit's table mock element (NSTableViewCellMockElement): it answers the
/// attribute API with AXPosition/AXSize in top-left global coordinates, and
/// its `accessibilityFrame` carries the same top-left numbers.
final class FakeTableMockElement: NSObject {
    let role: String
    let topLeft: CGRect
    weak var parentNode: AnyObject?
    var kids: [Any] = []

    init(_ role: String, topLeft: CGRect, parent: AnyObject?) {
        self.role = role
        self.topLeft = topLeft
        parentNode = parent
    }

    override func accessibilityAttributeValue(_ attribute: NSAccessibility.Attribute) -> Any? {
        switch attribute.rawValue {
        case "AXRole": return role
        case "AXPosition": return NSValue(point: topLeft.origin)
        case "AXSize": return NSValue(size: topLeft.size)
        case "AXChildren": return kids
        case "AXParent": return parentNode
        default: return nil
        }
    }

    /// The trap: top-left numbers through the frame getter.
    @objc func accessibilityFrame() -> NSRect { topLeft }
}

@MainActor
final class TableMockFrameTests: XCTestCase {
    func testATopLeftCellInABottomLeftOutlineResolvesToItsRowsLabel() {
        let h = ScreenGeometry.primaryHeight
        // The cell on screen, AppKit coordinates (bottom-left origin).
        let cellApp = NSRect(x: 2370, y: 2157, width: 844, height: 25)
        let cellTopLeft = CGRect(x: cellApp.minX, y: h - cellApp.maxY, width: cellApp.width, height: cellApp.height)
        let outline = FakeSwiftUINode("AXOutline", NSRect(x: 2359, y: 2044, width: 866, height: 149))
        let cell = FakeTableMockElement("AXCell", topLeft: cellTopLeft, parent: outline)
        let checkbox = FakeSwiftUINode("AXCheckBox", NSRect(x: 2380, y: 2159, width: 300, height: 20), label: "Order spare fans")
        checkbox.parent = cell
        cell.kids = [checkbox]
        let window = FakeSwiftUINode("AXWindow", NSRect(x: 2300, y: 1900, width: 1000, height: 400))
        let point = NSPoint(x: 2792, y: 2169.5)

        let ref = NSRect(x: 2300, y: 1900, width: 1000, height: 400)
        XCTAssertEqual(AXRead.frame(cell, near: ref), cellApp, "top-left numbers are flipped onto the window")
        XCTAssertTrue(AXRead.covers(cell, point, near: ref))
        let l = ElementLabels.resolve(inWindow: window, hits: [cell], at: point, near: ref)
        XCTAssertEqual(l?.text, "Order spare fans")
        XCTAssertEqual(l?.selector, "AXCell")
    }

    func testAHitTestAnswerIsNeverDroppedByAFrameCheck() {
        let window = FakeSwiftUINode("AXWindow", NSRect(x: 0, y: 0, width: 400, height: 300))
        // A hit whose frame (wrongly) does not hold the point still resolves.
        let button = FakeSwiftUINode("AXButton", NSRect(x: 0, y: -5000, width: 50, height: 20), label: "Order")
        XCTAssertEqual(ElementLabels.resolve(inWindow: window, hits: [button], at: NSPoint(x: 100, y: 100))?.text, "Order")
    }
}

/// One window with all three frame conventions the GUI runs met: a hosting
/// view and an AXSheet answering top-left numbers, a table mock cell
/// answering top-left numbers, and SwiftUI nodes answering AppKit
/// (bottom-left) coordinates.
@MainActor
final class MixedFrameTests: XCTestCase {
    private var h: CGFloat { ScreenGeometry.primaryHeight }

    /// AppKit rect → the top-left numbers some AppKit elements answer.
    private func topLeft(_ r: NSRect) -> NSRect { NSRect(x: r.minX, y: h - r.maxY, width: r.width, height: r.height) }

    private struct Tree {
        var window: FakeSwiftUINode
        var content: FakeSwiftUINode
        var cell: FakeTableMockElement
        var ref: NSRect
    }

    private func tree() -> Tree {
        // A display stacked above the primary one, as on the test Mac.
        let w = NSRect(x: 3000, y: h + 500, width: 900, height: 500)
        let window = FakeSwiftUINode("AXWindow", w)
        let contentApp = NSRect(x: w.minX, y: w.minY, width: 900, height: 472)
        let content = FakeSwiftUINode("AXGroup", topLeft(contentApp), parent: window)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 3020, y: w.minY + 420, width: 100, height: 24), label: "Show details", identifier: "show-details", parent: content)
        let outline = FakeSwiftUINode("AXOutline", NSRect(x: 3010, y: w.minY + 20, width: 880, height: 150), parent: content)
        let cellApp = NSRect(x: 3020, y: w.minY + 50, width: 860, height: 25)
        let cell = FakeTableMockElement("AXCell", topLeft: topLeft(cellApp), parent: outline)
        let checkbox = FakeSwiftUINode("AXCheckBox", NSRect(x: 3030, y: w.minY + 52, width: 300, height: 20), label: "Calibrate fan curve")
        checkbox.parent = cell
        cell.kids = [checkbox]
        outline.children.append(cell)
        let sheetApp = NSRect(x: 3270, y: w.minY + 200, width: 360, height: 125)
        let sheet = FakeSwiftUINode("AXSheet", topLeft(sheetApp), parent: window)
        let sheetHost = FakeSwiftUINode("AXGroup", topLeft(sheetApp), parent: sheet)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 3460, y: w.minY + 210, width: 59, height: 24), label: "Close", parent: sheetHost)
        _ = FakeSwiftUINode("AXButton", NSRect(x: 3535, y: w.minY + 210, width: 75, height: 24), label: "Approve", identifier: "approve", parent: sheetHost)
        return Tree(window: window, content: content, cell: cell, ref: w)
    }

    func testTheSheetsApproveResolvesWhenTheHitIsTheHostingView() {
        let t = tree()
        let p = NSPoint(x: 3560, y: t.ref.minY + 220)
        let l = ElementLabels.resolve(inWindow: t.window, hits: [t.content], at: p, near: t.ref)
        XCTAssertEqual(l?.text, "Approve")
        XCTAssertEqual(l?.selector, "AXButton#approve")
        let close = ElementLabels.resolve(inWindow: t.window, hits: [t.content], at: NSPoint(x: 3480, y: t.ref.minY + 220), near: t.ref)
        XCTAssertEqual(close?.text, "Close")
    }

    func testARowResolvesFromTheCellHitAndFromTheHostingView() {
        let t = tree()
        let p = NSPoint(x: 3500, y: t.ref.minY + 60)
        XCTAssertEqual(ElementLabels.resolve(inWindow: t.window, hits: [t.cell], at: p, near: t.ref)?.text, "Calibrate fan curve")
        let viaHost = ElementLabels.resolve(inWindow: t.window, hits: [t.content], at: p, near: t.ref)
        XCTAssertEqual(viaHost?.text, "Calibrate fan curve")
        XCTAssertEqual(viaHost?.selector, "AXCell")
    }

    func testAMainWindowButtonResolves() {
        let t = tree()
        let l = ElementLabels.resolve(inWindow: t.window, hits: [t.content], at: NSPoint(x: 3050, y: t.ref.minY + 430), near: t.ref)
        XCTAssertEqual(l?.text, "Show details")
        XCTAssertEqual(l?.selector, "AXButton#show-details")
    }

    func testNormalisationPicksTheFrameThatMeetsTheWindow() {
        let ref = NSRect(x: 0, y: 2000, width: 800, height: 600)
        let appKit = NSRect(x: 10, y: 2100, width: 50, height: 20)
        XCTAssertEqual(AXRead.normalise(appKit, near: ref, primaryHeight: 1329), appKit)
        let tl = NSRect(x: 10, y: 1329 - appKit.maxY, width: 50, height: 20)
        XCTAssertEqual(AXRead.normalise(tl, near: ref, primaryHeight: 1329), appKit)
        XCTAssertEqual(AXRead.normalise(tl, near: nil, primaryHeight: 1329), tl, "no reference: raw")
    }

    func testWhenBothFramesMeetTheWindowThePointDecides() {
        // A window across the middle of a 1000-point primary screen.
        let ref = NSRect(x: 0, y: 300, width: 800, height: 400)
        let appKit = NSRect(x: 10, y: 600, width: 50, height: 25)
        let tl = NSRect(x: 10, y: 1000 - appKit.maxY, width: 50, height: 25)
        XCTAssertTrue(tl.intersects(ref), "the raw top-left numbers meet the window too")
        XCTAssertEqual(AXRead.normalise(tl, near: ref, at: NSPoint(x: 20, y: 610), primaryHeight: 1000), appKit)
        XCTAssertEqual(AXRead.normalise(appKit, near: ref, at: NSPoint(x: 20, y: 610), primaryHeight: 1000), appKit)
        XCTAssertEqual(AXRead.normalise(tl, near: ref, primaryHeight: 1000), tl, "no point: raw")
    }
}
