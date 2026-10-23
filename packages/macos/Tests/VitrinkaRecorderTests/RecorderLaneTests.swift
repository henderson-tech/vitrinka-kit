import AppKit
import ImageIO
import SwiftUI
@testable import VitrinkaRecorder
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
    func testErrorsSkipAppleAndTheRecorder() {
        XCTAssertTrue(ConsoleLane.keep(subsystem: "dev.example.app", isError: true, osLevel: "error", filter: .errors))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "dev.example.app", isError: false, osLevel: "default", filter: .errors))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "com.apple.network", isError: true, osLevel: "error", filter: .errors))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "dev.vitrinka.recorder", isError: true, osLevel: "fault", filter: .errors))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "dev.example.app", isError: true, osLevel: "error", filter: .off))
    }

    func testAllSubsystemsAddsTheirNonDebugLines() {
        let f = VitrinkaRecorderConfiguration.LogCapture.all(subsystems: ["dev.example.app", ""])
        XCTAssertTrue(ConsoleLane.keep(subsystem: "dev.example.app", isError: false, osLevel: "default", filter: f))
        XCTAssertTrue(ConsoleLane.keep(subsystem: "", isError: false, osLevel: "default", filter: f))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "dev.example.app", isError: false, osLevel: "debug", filter: f))
        XCTAssertFalse(ConsoleLane.keep(subsystem: "dev.other", isError: false, osLevel: "default", filter: f))
        XCTAssertTrue(ConsoleLane.keep(subsystem: "dev.other", isError: true, osLevel: "error", filter: f))
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

/// The accessibility spike: does in-process `accessibilityHitTest` name a
/// control without the Accessibility permission? Offscreen windows, nothing
/// is shown.
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
        XCTAssertEqual(label.text, "open-settings", "identifier first, as Expo's testID")
        XCTAssertEqual(label.selector, "AXButton#open-settings")
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
