// swift-tools-version:5.9
//
// The Swift side of vitrinka-kit. SwiftPM reads a manifest only at the
// repository root, so this file sits here while every Swift source lives in
// packages/macos (see packages/macos/README.md). The npm workspaces ignore it.
//
// Consumers: .package(url: "https://github.com/henderson-tech/vitrinka-kit", ...)
// and .product(name: "VitrinkaRecorder", package: "vitrinka-kit").
import PackageDescription

let package = Package(
    name: "vitrinka-kit",
    platforms: [.macOS(.v14)],
    targets: [
        // Foundation only: wire types, API client, device link, durable
        // queue and the Swift port of @vitrinka/redact.
        .target(
            name: "VitrinkaRecorderCore",
            path: "packages/macos/Sources/VitrinkaRecorderCore"
        ),
        .testTarget(
            name: "VitrinkaRecorderCoreTests",
            dependencies: ["VitrinkaRecorderCore"],
            path: "packages/macos/Tests/VitrinkaRecorderCoreTests",
            // A copy of packages/redact/spec/vectors.json; a test fails when
            // the two drift apart.
            resources: [.copy("Resources/vectors.json")]
        ),
    ]
)
