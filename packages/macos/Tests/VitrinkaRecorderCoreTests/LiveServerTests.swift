import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
@testable import VitrinkaRecorderCore
import XCTest

/// The contract against a real vitrinka server. Skipped unless both
///   VITRINKA_E2E_URL    e.g. http://127.0.0.1:8097
///   VITRINKA_E2E_TOKEN  a recorder key (vkr_) whose project has an Apps
///                       rule for dev.vitrinka.recorder-demo
/// are set. It records one session (two screens, a click branch, a note, a
/// region annotation), stops it and reads the projection back.
final class LiveServerTests: XCTestCase {
    private func jpeg(width: Int, height: Int, shade: CGFloat) throws -> Data {
        let ctx = try XCTUnwrap(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        ctx.setFillColor(CGColor(red: shade, green: 0.5, blue: 1 - shade, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(CGRect(x: 40, y: height - 120, width: 200, height: 80))
        let image = try XCTUnwrap(ctx.makeImage())
        let data = NSMutableData()
        let dest = try XCTUnwrap(CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        return data as Data
    }

    func testRecordStopAndReadTheBoardBack() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let raw = env["VITRINKA_E2E_URL"], let base = URL(string: raw), let token = env["VITRINKA_E2E_TOKEN"], !token.isEmpty else {
            throw XCTSkip("set VITRINKA_E2E_URL and VITRINKA_E2E_TOKEN to run against a server")
        }
        let dir = TestSupport.tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        var config = EngineConfig(appID: "dev.vitrinka.recorder-demo", appVersion: "0.1.0", osVersion: "26.3.0", devicePixelRatio: 2, directory: dir)
        config.flushInterval = nil
        config.reconcileInterval = nil
        let api = VitrinkaAPI(base: base, credential: { ResolvedCredential(token: token, source: .environment) })
        let engine = RecorderEngine(config: config, api: api)

        let session = try await engine.start(title: "macOS recorder e2e \(Timestamp.iso(Date()))")
        let lane = Lane(tabId: "main", tabHost: "/main/items")
        await engine.push("nav", payload: ["route": "/main/items", "title": "Recorder demo"], lane: lane)
        await engine.enqueueShot(try jpeg(width: 1120, height: 920, shade: 0.2), lane: lane,
                                 payload: ["route": "/main/items", "title": "Recorder demo", "reason": "start", "w": 1120, "h": 920, "scale": 2])
        try await Task.sleep(nanoseconds: 20_000_000)
        await engine.push("click", payload: [
            "x": 140, "y": 840, "rect": ["x": 40, "y": 800, "w": 200, "h": 80],
            "text": "show-details", "selector": "AXButton#show-details", "route": "/main/items",
        ], lane: lane)
        try await Task.sleep(nanoseconds: 20_000_000)
        let details = Lane(tabId: "main", tabHost: "/main/details")
        await engine.push("nav", payload: ["route": "/main/details", "title": "Recorder demo", "sheet": "sheet"], lane: details)
        await engine.enqueueShot(try jpeg(width: 1120, height: 920, shade: 0.8), lane: details,
                                 payload: ["route": "/main/details", "title": "Recorder demo", "reason": "nav", "w": 1120, "h": 920, "scale": 2])
        try await Task.sleep(nanoseconds: 20_000_000)
        await engine.push("note", payload: ["text": "Approve button sits too low", "route": "/main/details"], lane: details)
        await engine.push("console", payload: ["level": "error", "osLevel": "error", "text": "demo: payment API answered 502", "subsystem": "dev.vitrinka.recorder-demo", "category": "demo"], lane: details)

        // Region annotate: the held frame's seq first, the note, then the frame at note ts + 1 ms.
        let reserved = await engine.reserveSeq()
        let held = try XCTUnwrap(reserved)
        let noteAt = Date()
        let ts = await engine.push("note", payload: [
            "text": "This total is wrong", "rect": ["x": 600, "y": 300, "w": 240, "h": 90], "annotate": true, "route": "/main/details",
        ], lane: details, at: noteAt)
        XCTAssertNotNil(ts)
        await engine.enqueueShot(try jpeg(width: 1120, height: 920, shade: 0.5), lane: details,
                                 payload: ["route": "/main/details", "title": "Recorder demo", "reason": "annotate"],
                                 at: noteAt.addingTimeInterval(0.001), reservedSeq: held)

        let outcome = try await engine.stop()
        print("vitrinka e2e: session \(outcome.sessionID) projection=\(outcome.projectionState ?? "-") board=\(outcome.boardURL?.absoluteString ?? "-")")
        XCTAssertEqual(outcome.sessionID, session.sessionId)
        XCTAssertEqual(outcome.projectionState, "ready")
        XCTAssertNotNil(outcome.boardURL)

        let row = try await api.json("GET", "/api/v1/sessions/\(session.sessionId)")
        print("vitrinka e2e: row eventCount=\(row["eventCount"]?.intValue ?? -1) maxSeq=\(row["maxSeq"]?.intValue ?? -1) status=\(row["status"]?.stringValue ?? "-") meta=\(row["meta"]?.serialized() ?? "-") projection=\(row["projection"]?.serialized() ?? "-")")
        XCTAssertEqual(row["status"], "done")
        XCTAssertEqual(row["maxSeq"]?.intValue, 9)
        XCTAssertEqual(row["eventCount"]?.intValue, 9)
        XCTAssertEqual(row["meta"]?["platform"], "macos")
        XCTAssertEqual(row["meta"]?["recorder"], .string(RecorderIdentity.recorderMeta))
        XCTAssertEqual(row["projection"]?["cards"]?.intValue, 3, "three shots, three screens")
    }
}
