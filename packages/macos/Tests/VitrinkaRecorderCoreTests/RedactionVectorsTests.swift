import Foundation
@testable import VitrinkaRecorderCore
import XCTest

/// Runs packages/redact/spec/vectors.json, the language-agnostic conformance
/// suite of the redaction engine, against the Swift port. The vectors ship
/// as a test resource (a copy); `testVectorsCopyMatchesTheKit` fails when the
/// copy drifts from packages/redact.
final class RedactionVectorsTests: XCTestCase {
    private func bundledVectors() throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "vectors", withExtension: "json"))
        return try Data(contentsOf: url)
    }

    func testVectorsCopyMatchesTheKit() throws {
        // packages/macos/Tests/VitrinkaRecorderCoreTests/<this file> → packages/redact/spec/vectors.json
        let kit = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("redact/spec/vectors.json")
        guard let source = try? Data(contentsOf: kit) else {
            throw XCTSkip("packages/redact is not next to this checkout (\(kit.path))")
        }
        XCTAssertEqual(try bundledVectors(), source,
                       "Tests/VitrinkaRecorderCoreTests/Resources/vectors.json drifted from packages/redact/spec/vectors.json — copy it again and fix the port")
    }

    func testEveryVector() throws {
        let doc = try JSONValue.parse(bundledVectors())
        let cases = try XCTUnwrap(doc["cases"]?.arrayValue)
        XCTAssertGreaterThanOrEqual(cases.count, 40)
        var ran = 0
        for c in cases {
            let name = c["name"]?.stringValue ?? "?"
            let policy = c["policy"].map(RedactionPolicy.init(json:))
            let rules = RedactionRules(policy: policy)
            switch c["surface"]?.stringValue {
            case "headerName":
                let want = c["sensitive"]?.boolValue == true
                for input in c["inputs"]?.arrayValue?.compactMap(\.stringValue) ?? [] {
                    XCTAssertEqual(Redact.sensitiveHeader(rules, input), want, "\(name): \(input)")
                }
            case "headers":
                let input = (c["input"]?.objectValue?.entries ?? []).compactMap { e in e.value.stringValue.map { (e.key, $0) } }
                let out = Redact.redactHeaders(rules, input)
                let map = Dictionary(out, uniquingKeysWith: { a, _ in a })
                for k in c["redactedKeys"]?.arrayValue?.compactMap(\.stringValue) ?? [] {
                    XCTAssertEqual(map[k], REDACTED, "\(name): \(k)")
                }
                for e in c["keptEntries"]?.objectValue?.entries ?? [] {
                    XCTAssertEqual(map[e.key], e.value.stringValue, "\(name): \(e.key)")
                }
                for e in c["valueMustNotContain"]?.objectValue?.entries ?? [] {
                    for s in e.value.arrayValue?.compactMap(\.stringValue) ?? [] {
                        XCTAssertFalse((map[e.key] ?? "").contains(s), "\(name): \(e.key) still has \(s)")
                    }
                }
            case "body":
                let out = Redact.redactBody(rules, c["input"]?.stringValue ?? "", contentType: c["contentType"]?.stringValue)
                check(c, out, name)
                if c["outputIsJson"]?.boolValue == true {
                    XCTAssertNoThrow(try JSONValue.parse(out), "\(name): output is not JSON: \(out)")
                }
            case "url":
                check(c, Redact.redactUrl(rules, c["input"]?.stringValue ?? ""), name)
            default:
                XCTFail("\(name): unknown surface")
                continue
            }
            ran += 1
        }
        XCTAssertEqual(ran, cases.count, "every vector ran; none is skipped")
    }

    private func check(_ c: JSONValue, _ out: String, _ name: String) {
        if let exact = c["exact"]?.stringValue {
            XCTAssertEqual(out, exact, name)
        }
        for s in c["mustNotContain"]?.arrayValue?.compactMap(\.stringValue) ?? [] {
            XCTAssertFalse(out.contains(s), "\(name): output still contains \(s): \(out)")
        }
        for s in c["mustContain"]?.arrayValue?.compactMap(\.stringValue) ?? [] {
            XCTAssertTrue(out.contains(s), "\(name): output lacks \(s): \(out)")
        }
    }
}

/// The surfaces the macOS recorder itself feeds through the engine: labels,
/// console lines, routes and window titles.
final class RedactionSurfaceTests: XCTestCase {
    let rules = RedactionRules.defaults

    func testConsoleLinesLoseCredentials() {
        let line = "request failed: Authorization: Bearer sk_live_abc123 token=hunter2 next"
        let out = rules.redactText(line)
        XCTAssertFalse(out.contains("sk_live_abc123"))
        XCTAssertFalse(out.contains("hunter2"))
        XCTAssertTrue(out.contains("request failed"))
    }

    func testJWTsAndPemKeysInText() {
        XCTAssertEqual(rules.redactText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig done"), "jwt [redacted] done")
        let pem = "key -----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- end"
        XCTAssertEqual(rules.redactText(pem), "key [redacted] end")
    }

    func testBenignLabelsStayByteIdentical() {
        for s in ["Save", "Open settings", "Delete item 3", "Author: Lukáš", "Ünïcødé 🚀 label"] {
            XCTAssertEqual(rules.redactText(s), s)
        }
    }

    func testRoutesScrubQueryAndFragment() {
        XCTAssertEqual(rules.redactUrl("/main/reset?token=abc&tab=2"), "/main/reset?token=[redacted]&tab=2")
        XCTAssertEqual(rules.redactUrl("/main/items"), "/main/items")
    }

    func testTokenMatchingIsByWordNotSubstring() {
        XCTAssertTrue(Redact.isSecretKey("X-Dev-Auth-Secret"))
        XCTAssertTrue(Redact.isSecretKey("otpCode"))
        XCTAssertTrue(Redact.isSecretKey("privateKey"))
        XCTAssertFalse(Redact.isSecretKey("author"))
        XCTAssertFalse(Redact.isSecretKey("pinned"))
        XCTAssertFalse(Redact.isSecretKey("privateKeyboardEnabled"))
    }

    func testPercentDecodingFailsClosedPerEscape() {
        // A malformed tail must not hide an encoded secret pair before it.
        let out = rules.redactUrl("https://x.example/cb?next=token%3Dhunter2%ZZ")
        XCTAssertFalse(out.contains("hunter2"))
        XCTAssertNil(decodeURIComponent("%E0%80"))
        XCTAssertEqual(decodeURIComponent("caf%C3%A9"), "café")
    }

    func testFullFidelityPassesThrough() {
        let full = RedactionRules(policy: RedactionPolicy(fullFidelity: true))
        XCTAssertEqual(full.redactText("token=abc"), "token=abc")
        XCTAssertEqual(full.pixelPolicy, .none)
        XCTAssertEqual(RedactionRules(policy: RedactionPolicy(maskAllText: true)).pixelPolicy, .blur)
    }

    func testPolicyWithoutAPolicyKeyIsUnknown() {
        XCTAssertNil(PolicyAnswer(json: ["attachments": true]).policy, "out of contract: keep the defaults")
        XCTAssertEqual(PolicyAnswer(json: ["policy": [:], "attachments": true]).policy, RedactionPolicy())
    }
}
