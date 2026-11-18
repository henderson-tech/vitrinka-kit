#if DEBUG
import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import VitrinkaRecorderCore

/// Where a keyframe sits on screen: its top-left in global CG points and its
/// pixels per point. Click and annotation rects map into this pixel space.
struct CaptureGeometry: Equatable, Sendable {
    var originCG: CGPoint
    var sizePoints: CGSize
    var scale: Double

    /// A global CG point → keyframe pixels.
    func pixel(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - originCG.x) * scale, y: (p.y - originCG.y) * scale)
    }

    /// A global CG rect → keyframe pixels, rounded (the wire takes integers).
    func pixelRect(_ r: CGRect) -> CGRect {
        CGRect(
            x: ((r.minX - originCG.x) * scale).rounded(),
            y: ((r.minY - originCG.y) * scale).rounded(),
            width: (r.width * scale).rounded(),
            height: (r.height * scale).rounded()
        )
    }
}

/// An encoded keyframe.
struct CapturedFrame: Sendable {
    var jpeg: Data
    var pixelWidth: Int
    var pixelHeight: Int
    var geometry: CaptureGeometry
    /// A hash of a small thumbnail; equal hashes mean an unchanged screen.
    var thumbHash: UInt64
    var capturedAt: Date
    /// "window" (window-server pixels) or "view" (an AppKit redraw, the
    /// macOS 14.0–14.3 fallback).
    var fidelity: String
}

/// CGImage crosses from ScreenCaptureKit's callback to the encoder; it is
/// immutable.
struct SendableImage: @unchecked Sendable {
    let image: CGImage
}

enum CaptureFailure: Error {
    case windowNotShareable
    case privateViewUnresolved
    case encodeFailed
}

/// Takes keyframes of the app's own windows.
///
/// macOS 14.4+: ScreenCaptureKit with `SCShareableContent.currentProcess`,
/// which needs no Screen Recording permission for the process's own windows
/// and yields window-server pixels (Metal, materials, title bar). One window
/// is a `desktopIndependentWindow` capture; a window with an attached sheet
/// or popover is a display capture limited to exactly those windows. The
/// HUD and the annotate overlay are never in the list.
///
/// macOS 14.0–14.3: an AppKit redraw of the window (`cacheDisplay`), marked
/// `fidelity: "view"`. It misses Metal layers and materials.
@MainActor
enum WindowCapture {
    nonisolated static let blurWidth = 96

    static func capture(laneWindow: NSWindow, blur: Bool) async throws -> CapturedFrame {
        let parts = [laneWindow] + Lanes.overlays(of: laneWindow)
        guard let before = PrivateRegistry.shared.privateRects(on: parts) else { throw CaptureFailure.privateViewUnresolved }
        let grabbed: (SendableImage, CaptureGeometry, String)
        if #available(macOS 14.4, *) {
            let ids = parts.map { CGWindowID($0.windowNumber) }
            let r = try await ShotGrabber.grab(windowIDs: ids)
            grabbed = (r.image, r.geometry, "window")
        } else {
            grabbed = try redraw(laneWindow)
        }
        // The frame may have moved while the window server answered: mask
        // the private rects of both moments.
        guard let after = PrivateRegistry.shared.privateRects(on: parts) else { throw CaptureFailure.privateViewUnresolved }
        let geometry = grabbed.1
        let masks = (before + after).map { geometry.pixelRect($0) }
        let capturedAt = Date()
        let image = grabbed.0
        let fidelity = grabbed.2
        return try await Task.detached(priority: .userInitiated) {
            try FrameEncoder.encode(image, masks: masks, geometry: geometry, blurWidth: blur ? blurWidth : nil, capturedAt: capturedAt, fidelity: fidelity)
        }.value
    }

    private static func redraw(_ window: NSWindow) throws -> (SendableImage, CaptureGeometry, String) {
        guard let view = window.contentView?.superview ?? window.contentView,
              let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds)
        else { throw CaptureFailure.windowNotShareable }
        view.cacheDisplay(in: view.bounds, to: rep)
        guard let cg = rep.cgImage else { throw CaptureFailure.windowNotShareable }
        let frame = ScreenGeometry.toCG(window.convertToScreen(view.convert(view.bounds, to: nil)))
        let geometry = CaptureGeometry(originCG: frame.origin, sizePoints: frame.size, scale: Double(cg.width) / max(1, frame.width))
        return (SendableImage(image: cg), geometry, "view")
    }
}

@available(macOS 14.4, *)
enum ShotGrabber {
    struct Grab: Sendable {
        var image: SendableImage
        var geometry: CaptureGeometry
    }

    static func grab(windowIDs: [CGWindowID]) async throws -> Grab {
        let content = try await SCShareableContent.currentProcess
        let windows = windowIDs.compactMap { id in content.windows.first { $0.windowID == id } }
        guard let main = windows.first, main.windowID == windowIDs.first else { throw CaptureFailure.windowNotShareable }
        let config = SCStreamConfiguration()
        config.showsCursor = false
        config.ignoreShadowsSingleWindow = true
        config.captureResolution = .best
        let filter: SCContentFilter
        let rect: CGRect
        if windows.count == 1 {
            filter = SCContentFilter(desktopIndependentWindow: main)
            rect = main.frame
        } else {
            let union = windows.dropFirst().reduce(main.frame) { $0.union($1.frame) }
            let center = CGPoint(x: union.midX, y: union.midY)
            guard let display = content.displays.first(where: { $0.frame.contains(center) }) ?? content.displays.first else {
                throw CaptureFailure.windowNotShareable
            }
            filter = SCContentFilter(display: display, including: windows)
            config.sourceRect = union.offsetBy(dx: -display.frame.minX, dy: -display.frame.minY)
            config.ignoreShadowsDisplay = true
            rect = union
        }
        let scale = Double(filter.pointPixelScale)
        config.width = max(1, Int((rect.width * scale).rounded()))
        config.height = max(1, Int((rect.height * scale).rounded()))
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let geometry = CaptureGeometry(originCG: rect.origin, sizePoints: rect.size, scale: Double(image.width) / max(1, rect.width))
        return Grab(image: SendableImage(image: image), geometry: geometry)
    }
}

enum FrameEncoder {
    /// Paint the private rects black, downscale under a blur policy, encode
    /// JPEG at 0.7 and hash a thumbnail. Masking happens before encoding, so
    /// the private pixels never exist in an encoded frame.
    static func encode(_ src: SendableImage, masks: [CGRect], geometry: CaptureGeometry, blurWidth: Int?, capturedAt: Date, fidelity: String) throws -> CapturedFrame {
        let image = src.image
        let w = image.width
        let h = image.height
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw CaptureFailure.encodeFailed }
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        for m in masks {
            // Pixel rects are top-left; the context is bottom-left.
            let r = CGRect(x: m.minX, y: CGFloat(h) - m.maxY, width: m.width, height: m.height).insetBy(dx: -1, dy: -1)
            ctx.fill(r)
        }
        guard var masked = ctx.makeImage() else { throw CaptureFailure.encodeFailed }
        var geo = geometry
        if let bw = blurWidth, w > bw {
            let bh = max(1, Int((Double(h) * Double(bw) / Double(w)).rounded()))
            guard let small = CGContext(data: nil, width: bw, height: bh, bitsPerComponent: 8, bytesPerRow: 0,
                                        space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
            else { throw CaptureFailure.encodeFailed }
            small.interpolationQuality = .medium
            small.draw(masked, in: CGRect(x: 0, y: 0, width: bw, height: bh))
            guard let img = small.makeImage() else { throw CaptureFailure.encodeFailed }
            masked = img
            geo.scale = Double(bw) / max(1, geometry.sizePoints.width)
        }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CaptureFailure.encodeFailed
        }
        CGImageDestinationAddImage(dest, masked, [kCGImageDestinationLossyCompressionQuality: WindowCapture.jpegQualityValue] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw CaptureFailure.encodeFailed }
        return CapturedFrame(
            jpeg: data as Data, pixelWidth: masked.width, pixelHeight: masked.height, geometry: geo,
            thumbHash: thumbnailHash(masked), capturedAt: capturedAt, fidelity: fidelity
        )
    }

    /// FNV-1a over a 32×32 grayscale thumbnail.
    static func thumbnailHash(_ image: CGImage) -> UInt64 {
        let side = 32
        guard let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return 0 }
        ctx.interpolationQuality = .low
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let p = ctx.data else { return 0 }
        let bytes = p.bindMemory(to: UInt8.self, capacity: side * side)
        var hash: UInt64 = 0xCBF2_9CE4_8422_2325
        for i in 0 ..< side * side {
            hash ^= UInt64(bytes[i])
            hash = hash &* 0x0000_0100_0000_01B3
        }
        return hash
    }
}

extension WindowCapture {
    nonisolated static let jpegQualityValue: Double = 0.7
}
#endif
