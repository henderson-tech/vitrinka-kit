import Foundation
@testable import VitrinkaRecorderCore
import XCTest

/// One request the mock server saw.
struct SeenRequest {
    var method: String
    var path: String
    var query: String?
    var headers: [String: String]
    var body: Data

    var json: JSONValue? { try? JSONValue.parse(body) }

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

enum MockAnswer {
    case json(Int, JSONValue)
    case status(Int)
    /// A transport failure (offline).
    case offline
}

/// A scripted vitrinka server behind URLProtocol. Tests run serially, so
/// one global instance is swapped per test.
final class MockServer: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [SeenRequest] = []
    private var route: (SeenRequest) -> MockAnswer

    nonisolated(unsafe) static var current: MockServer?

    init(_ route: @escaping (SeenRequest) -> MockAnswer = MockServer.happy) {
        self.route = route
    }

    var requests: [SeenRequest] {
        lock.lock()
        defer { lock.unlock() }
        return seen
    }

    func setRoute(_ r: @escaping (SeenRequest) -> MockAnswer) {
        lock.lock()
        route = r
        lock.unlock()
    }

    func answer(_ r: SeenRequest) -> MockAnswer {
        lock.lock()
        seen.append(r)
        let route = self.route
        lock.unlock()
        return route(r)
    }

    func requests(_ method: String, _ pathPrefix: String) -> [SeenRequest] {
        requests.filter { $0.method == method && $0.path.hasPrefix(pathPrefix) }
    }

    /// The server as 5.27.0 behaves for a recorder key.
    static func happy(_ r: SeenRequest) -> MockAnswer {
        switch (r.method, r.path) {
        case ("GET", "/api/v1/recorder/policy"):
            return .json(200, ["attachments": true, "fullFidelityAllowed": false, "policy": [:]])
        case ("POST", "/api/v1/sessions"):
            return .json(201, ["id": 42, "project": "recorder-e2e", "environment": "development", "title": r.json?["title"] ?? ""])
        case ("POST", "/api/v1/sessions/42/events"):
            return .json(200, ["inserted": .number(Double(r.json?["events"]?.arrayValue?.count ?? 0))])
        case ("POST", "/api/v1/sessions/42/shot"):
            let seq = r.query?.replacingOccurrences(of: "seq=", with: "") ?? "?"
            return .json(201, ["blobKey": .string("uploads/sessions/42/\(seq).jpg"), "url": "/x"])
        case ("PATCH", "/api/v1/sessions/42"):
            return .json(200, ["id": 42, "status": r.json?["status"] ?? "", "boardSlug": "", "projection": ["state": "queued"]])
        case ("GET", "/api/v1/sessions/42"):
            return .json(200, [
                "id": 42, "status": "done", "maxSeq": 3, "boardSlug": "recorder-e2e-session-42",
                "boardUrl": "http://localhost:8097/w/dev/boards/recorder-e2e-session-42",
                "projection": ["state": "ready", "boardSlug": "recorder-e2e-session-42", "cards": 1],
            ])
        default:
            return .status(404)
        }
    }
}

final class MockURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let server = MockServer.current, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buf = [UInt8](repeating: 0, count: 64 * 1024)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                body.append(buf, count: n)
            }
            stream.close()
        }
        let seen = SeenRequest(
            method: request.httpMethod ?? "GET",
            path: url.path,
            query: url.query,
            headers: request.allHTTPHeaderFields ?? [:],
            body: body
        )
        switch server.answer(seen) {
        case .offline:
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
        case let .status(code):
            respond(code, Data())
        case let .json(code, value):
            respond(code, value.serializedData())
        }
    }

    private func respond(_ code: Int, _ data: Data) {
        let resp = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

enum TestSupport {
    static func tempDir() -> URL {
        let d = FileManager.default.temporaryDirectory
            .appendingPathComponent("vitrinka-recorder-tests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    static func mockConfiguration() -> URLSessionConfiguration {
        let c = VitrinkaAPI.defaultConfiguration()
        c.protocolClasses = [MockURLProtocol.self]
        return c
    }

    static func engineConfig(_ dir: URL) -> EngineConfig {
        var c = EngineConfig(appID: "dev.vitrinka.recorder-demo", appVersion: "1.2.3", osVersion: "26.3.0", devicePixelRatio: 2, directory: dir)
        c.flushInterval = nil
        c.reconcileInterval = nil
        c.persistDebounce = 0.05
        c.drainDeadline = 0.5
        c.drainRetryPause = 0.01
        c.boardPollInterval = 0.01
        c.boardPollDeadline = 0.5
        return c
    }

    static func engine(dir: URL, credential: @escaping @Sendable () -> ResolvedCredential? = { ResolvedCredential(token: "vkr_test", source: .environment) }) -> RecorderEngine {
        let api = VitrinkaAPI(base: URL(string: "http://127.0.0.1:8097")!, configuration: mockConfiguration(), credential: credential)
        return RecorderEngine(config: engineConfig(dir), api: api, jitter: { 1 })
    }

    static let lane = Lane(tabId: "main", tabHost: "/main")

    /// The policy fetch runs beside the create; let it land before asserting
    /// on the request log.
    static func settle() async {
        try? await Task.sleep(nanoseconds: 50_000_000)
    }
}
