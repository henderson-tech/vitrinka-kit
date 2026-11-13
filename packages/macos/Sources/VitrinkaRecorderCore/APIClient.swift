#if DEBUG
import Foundation
import os

package enum RecorderLog {
    /// The recorder's own unified-log subsystem. The console lane skips it, so
    /// a failing flush can never feed itself.
    package static let subsystem = "dev.vitrinka.recorder"
    package static let engine = Logger(subsystem: subsystem, category: "engine")
    package static let capture = Logger(subsystem: subsystem, category: "capture")
    package static let link = Logger(subsystem: subsystem, category: "link")
}

/// A server verdict retrying can never fix: 4xx except 408 and 429.
package func permanentStatus(_ status: Int) -> Bool {
    status >= 400 && status < 500 && status != 408 && status != 429
}

/// Where the bearer of a request came from. A 401 forgets only a device link.
package enum CredentialSource: String, Sendable {
    case environment
    case userDefaults
    case deviceLink
    case host
}

package struct ResolvedCredential: Sendable, Equatable {
    package var token: String
    package var source: CredentialSource
    package init(token: String, source: CredentialSource) {
        self.token = token
        self.source = source
    }
}

package struct VitrinkaAPIError: Error, Sendable, CustomStringConvertible {
    /// The HTTP status; 0 for a transport failure (offline, timeout, reset).
    package let status: Int
    package let message: String
    /// The credential the failed request carried.
    package let credentialSource: CredentialSource?

    package var isPermanent: Bool { permanentStatus(status) }
    package var isUnauthorized: Bool { status == 401 }
    package var description: String { status == 0 ? message : "\(status): \(message)" }
}

/// The ingest client. Every request carries the bearer and the canary
/// User-Agent, and never an `Origin` header: the server skips its origin
/// check for native clients, and a browser origin on a native-only key is a
/// 403. No cookies, no cache.
package final class VitrinkaAPI: Sendable {
    package let base: URL
    private let baseString: String
    private let session: URLSession
    private let credential: @Sendable () -> ResolvedCredential?

    package static func defaultConfiguration() -> URLSessionConfiguration {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieAcceptPolicy = .never
        c.httpShouldSetCookies = false
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 30
        c.waitsForConnectivity = false
        return c
    }

    package init(
        base: URL,
        configuration: URLSessionConfiguration = VitrinkaAPI.defaultConfiguration(),
        credential: @escaping @Sendable () -> ResolvedCredential?
    ) {
        self.base = base
        var s = base.absoluteString
        while s.hasSuffix("/") { s.removeLast() }
        baseString = s
        session = URLSession(configuration: configuration)
        self.credential = credential
    }

    package func url(_ path: String) -> URL {
        // `path` is a fixed route plus our own ids, never user input.
        URL(string: baseString + path)!
    }

    private func request(_ method: String, _ path: String, contentType: String?) -> (URLRequest, CredentialSource?) {
        var r = URLRequest(url: url(path))
        r.httpMethod = method
        r.setValue(RecorderIdentity.userAgent, forHTTPHeaderField: "User-Agent")
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let contentType { r.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        let cred = credential()
        if let cred { r.setValue("Bearer \(cred.token)", forHTTPHeaderField: "Authorization") }
        return (r, cred?.source)
    }

    private func send(_ r: URLRequest, body: Data?, source: CredentialSource?) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            var req = r
            req.httpBody = body
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw VitrinkaAPIError(status: 0, message: "\(r.httpMethod ?? "") \(r.url?.path ?? ""): \(error.localizedDescription)", credentialSource: source)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let text = String(decoding: data.prefix(512), as: UTF8.self)
            throw VitrinkaAPIError(status: status, message: "\(r.httpMethod ?? "") \(r.url?.path ?? "") → \(status): \(text)", credentialSource: source)
        }
        return data
    }

    /// A JSON request. An empty answer reads as `{}`.
    @discardableResult
    package func json(_ method: String, _ path: String, body: JSONValue? = nil) async throws -> JSONValue {
        try await raw(method, path, body: body.map { $0.serializedData() })
    }

    /// A JSON request whose body is already serialized (the events batch).
    @discardableResult
    package func raw(_ method: String, _ path: String, body: Data?) async throws -> JSONValue {
        let (r, source) = request(method, path, contentType: body == nil ? nil : "application/json")
        let data = try await send(r, body: body, source: source)
        if data.isEmpty { return .object([:]) }
        return (try? JSONValue.parse(data)) ?? .object([:])
    }

    /// `POST /api/v1/sessions/:id/shot?seq=N` with the image as the raw body.
    /// Returns the `blobKey` the shot event must carry.
    package func uploadShot(sessionID: String, seq: Int, data: Data, mime: String) async throws -> String {
        let (prepared, source) = request("POST", "/api/v1/sessions/\(sessionID)/shot?seq=\(seq)", contentType: mime)
        var r = prepared
        r.timeoutInterval = 60
        let answer = try await send(r, body: data, source: source)
        guard let json = try? JSONValue.parse(answer), let key = json["blobKey"]?.stringValue, !key.isEmpty else {
            // A 2xx without a blobKey cannot bind the frame: the projection
            // skips a shot event without one. Treat it as a server fault.
            throw VitrinkaAPIError(status: 502, message: "shot seq \(seq): answer has no blobKey", credentialSource: source)
        }
        return key
    }
}
#endif
