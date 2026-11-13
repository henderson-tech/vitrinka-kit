import Foundation
@testable import VitrinkaRecorderCore
import XCTest

final class JSONValueTests: XCTestCase {
    func testSerializesLikeJSONStringify() {
        let v: JSONValue = ["b": 1, "a": [true, nil, 1.5, "x\"y\\z\n\u{1}"], "c": ["d": -0.0]]
        XCTAssertEqual(v.serialized(), #"{"b":1,"a":[true,null,1.5,"x\"y\\z\n\u0001"],"c":{"d":0}}"#)
    }

    func testNumbersFormatLikeJavaScript() {
        let cases: [(Double, String)] = [
            (0, "0"), (1, "1"), (-2, "-2"), (0.1, "0.1"), (100_000, "100000"), (1e21, "1e+21"),
            (1.2345678901234568e20, "123456789012345680000"), (0.00001, "0.00001"), (1e-7, "1e-7"),
            (1.5e300, "1.5e+300"), (123.456, "123.456"), (2.5e-8, "2.5e-8"),
        ]
        for (d, s) in cases { XCTAssertEqual(JSONValue.jsNumber(d), s, "\(d)") }
    }

    func testIntegerLikeKeysComeFirstAsInJavaScript() throws {
        let v = try JSONValue.parse(#"{"b":1,"10":2,"2":3,"a":4,"01":5}"#)
        XCTAssertEqual(v.serialized(), #"{"2":3,"10":2,"b":1,"a":4,"01":5}"#)
    }

    func testParseIsStrictAndKeepsOrderAndUnicode() throws {
        let v = try JSONValue.parse(#" { "z" : "ž🚀" , "a" : [ 1 , 2e3 ] } "#)
        XCTAssertEqual(v.objectValue?.keys, ["z", "a"])
        XCTAssertEqual(v["z"], "ž🚀")
        XCTAssertEqual(v["a"]?.arrayValue?.last, 2000)
        for bad in ["{", #"{"a":1,}"#, "[1,]", "01", "\"\t\"", "nul", "{} x"] {
            XCTAssertThrowsError(try JSONValue.parse(bad), bad)
        }
    }

    func testDuplicateKeysKeepTheLastValueAtTheFirstPosition() throws {
        XCTAssertEqual(try JSONValue.parse(#"{"a":1,"b":2,"a":3}"#).serialized(), #"{"a":3,"b":2}"#)
    }
}

final class DeviceLinkTests: XCTestCase {
    var server: MockServer!

    override func setUp() {
        server = MockServer()
        MockServer.current = server
    }

    override func tearDown() { MockServer.current = nil }

    private var session: URLSession { URLSession(configuration: TestSupport.mockConfiguration()) }

    func testOriginAndWorkspaceOfABase() {
        XCTAssertEqual(DeviceLink.origin(of: URL(string: "https://app.vitrinka.ai/w/acme")!), "https://app.vitrinka.ai")
        XCTAssertEqual(DeviceLink.origin(of: URL(string: "http://localhost:8097")!), "http://localhost:8097")
        XCTAssertEqual(DeviceLink.origin(of: URL(string: "https://x.example:443/")!), "https://x.example")
        XCTAssertEqual(DeviceLink.workspace(of: URL(string: "https://app.vitrinka.ai/w/acme/boards")!), "acme")
        XCTAssertNil(DeviceLink.workspace(of: URL(string: "http://localhost:8097")!))
    }

    func testStartSendsKindAndLabelAndKeepsURLsOnTheOrigin() async throws {
        server.setRoute { r in
            XCTAssertEqual(r.path, "/api/v1/cli/auth")
            return .json(201, [
                "device_code": "dc1", "user_code": "ABCD-EFGH", "verify_path": "/cli-auth?code=ABCD-EFGH",
                "verify_url": "https://evil.example/cli-auth?code=ABCD-EFGH", "qr_path": "/cli-auth/qr?code=ABCD-EFGH",
                "interval": 1, "expires_in": 600,
            ])
        }
        let base = URL(string: "https://app.vitrinka.ai/w/acme")!
        let start = try await DeviceLink.start(base: base, label: "RecorderDemo on macOS", session: session)
        let body = try XCTUnwrap(server.requests.first?.json)
        XCTAssertEqual(body, ["kind": "recorder", "label": "RecorderDemo on macOS"])
        XCTAssertNil(server.requests.first?.header("Origin"))
        XCTAssertEqual(start.userCode, "ABCD-EFGH")
        XCTAssertEqual(start.interval, 2, "never below 2 s")
        XCTAssertEqual(start.verifyURL.host, "app.vitrinka.ai", "an off-origin verify_url is pulled back to the origin")
        XCTAssertTrue(start.verifyURL.absoluteString.contains("workspace=acme"))
        XCTAssertEqual(start.qrURL.host, "app.vitrinka.ai")
    }

    func testPollWaitsThroughPendingAndTransientAnswers() async throws {
        var calls = 0
        server.setRoute { _ in
            calls += 1
            switch calls {
            case 1: return .json(202, ["status": "pending"])
            case 2: return .status(503)
            case 3: return .offline
            default: return .json(200, ["token": "vkr_new", "kind": "recorder", "workspace": "acme", "label": "x", "expires_in": 2_592_000])
            }
        }
        let start = LinkStart(deviceCode: "dc1", userCode: "A", verifyURL: URL(string: "https://a.example/v")!, qrURL: URL(string: "https://a.example/q")!, interval: 2, expiresIn: 600)
        let linked = try await DeviceLink.poll(base: URL(string: "https://app.vitrinka.ai/w/acme")!, start: start, session: session, sleep: { _ in })
        XCTAssertEqual(linked.token, "vkr_new")
        XCTAssertEqual(linked.workspace, "acme")
        XCTAssertEqual(server.requests.first?.json, ["device_code": "dc1"])
    }

    func testPollRefusesATokenFromAnotherWorkspaceAndReportsExpiry() async throws {
        let start = LinkStart(deviceCode: "dc1", userCode: "A", verifyURL: URL(string: "https://a.example/v")!, qrURL: URL(string: "https://a.example/q")!, interval: 2, expiresIn: 600)
        server.setRoute { _ in .json(200, ["token": "vkr_other", "workspace": "personal"]) }
        do {
            _ = try await DeviceLink.poll(base: URL(string: "https://app.vitrinka.ai/w/acme")!, start: start, session: session, sleep: { _ in })
            XCTFail("expected a mismatch")
        } catch let e as DeviceLinkError {
            XCTAssertEqual(e, .workspaceMismatch(linked: "personal", expected: "acme"))
        }
        server.setRoute { _ in .status(404) }
        do {
            _ = try await DeviceLink.poll(base: URL(string: "http://localhost:8097")!, start: start, session: session, sleep: { _ in })
            XCTFail("expected expiry")
        } catch let e as DeviceLinkError {
            XCTAssertEqual(e, .expired)
        }
    }
}
