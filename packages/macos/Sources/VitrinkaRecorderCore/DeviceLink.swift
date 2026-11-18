#if DEBUG
import Foundation

// The device link, ported from packages/link/src/index.ts: a short code the
// tester approves in vitrinka mints an ingest-only `vkr_` recorder token.
//
//   POST {origin}/api/v1/cli/auth        {kind:"recorder", label}
//     → 201 {device_code, user_code, verify_path, verify_url?, qr_path, interval, expires_in}
//   POST {origin}/api/v1/cli/auth/claim  {device_code}
//     → 202 pending · 200 {token, kind, workspace, label, expires_in} · 404 expired
//
// A base that addresses one workspace (`…/w/<slug>`) adds `workspace=<slug>`
// to the approve URL and refuses a token approved into another workspace.

package struct LinkStart: Sendable, Equatable {
    package var deviceCode: String
    package var userCode: String
    package var verifyURL: URL
    package var qrURL: URL
    /// Seconds between claims (never below 2).
    package var interval: Int
    package var expiresIn: Int
}

/// A claimed link token, as stored in `link.json` (mode 0600).
package struct LinkedToken: Sendable, Equatable, Codable {
    package var token: String
    package var workspace: String
    package var label: String
    package var expiresIn: Int
    package var linkedAt: Date
}

package enum DeviceLinkError: Error, Sendable, Equatable, CustomStringConvertible {
    /// The server no longer knows the code (expired or consumed).
    case expired
    /// Approved into another workspace than the one the base addresses.
    case workspaceMismatch(linked: String, expected: String)
    /// Any other definitive refusal.
    case refused(status: Int)
    case malformed(String)

    package var description: String {
        switch self {
        case .expired: return "link code expired"
        case let .workspaceMismatch(linked, expected):
            return "linked into \(linked) — this app records into \(expected); link again and pick \(expected)"
        case let .refused(status): return "link refused (\(status))"
        case let .malformed(what): return "link answer malformed (\(what))"
        }
    }
}

package enum DeviceLink {
    /// The control-plane origin of a base URL, e.g. `https://app.vitrinka.ai`.
    package static func origin(of base: URL) -> String {
        guard let c = URLComponents(url: base, resolvingAgainstBaseURL: false), let scheme = c.scheme?.lowercased(),
              let host = c.percentEncodedHost?.lowercased()
        else { return base.absoluteString }
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        if let port = c.port, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    /// The workspace slug of a `/w/<slug>` base, or nil for a bare origin.
    package static func workspace(of base: URL) -> String? {
        guard let path = URLComponents(url: base, resolvingAgainstBaseURL: false)?.percentEncodedPath else { return nil }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count >= 3, parts[0].isEmpty, parts[1] == "w", !parts[2].isEmpty else { return nil }
        let raw = String(parts[2])
        return raw.removingPercentEncoding ?? raw
    }

    /// Resolve a server-supplied path or URL against the origin and accept it
    /// only on that same origin over http(s); anything else falls back to the
    /// origin's own path. The result is opened in the browser.
    static func sameOriginURL(_ origin: String, _ candidate: String?, _ fallbackPath: String, _ defaultPath: String) -> URL {
        func own(_ v: String?) -> URL? {
            guard let v, !v.isEmpty, let originURL = URL(string: origin), let u = URL(string: v, relativeTo: originURL)?.absoluteURL,
                  let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https"
            else { return nil }
            if Self.origin(of: u) == origin { return u }
            var tail = u.path
            if let q = u.query { tail += "?" + q }
            return URL(string: origin + tail)
        }
        return own(candidate) ?? own(fallbackPath) ?? URL(string: origin + defaultPath)!
    }

    static func withWorkspace(_ url: URL, _ workspace: String?) -> URL {
        guard let workspace, var c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        var items = (c.queryItems ?? []).filter { $0.name != "workspace" }
        items.append(URLQueryItem(name: "workspace", value: workspace))
        c.queryItems = items
        return c.url ?? url
    }

    private static func post(_ session: URLSession, _ url: URL, _ body: JSONValue) async throws -> (Int, Data, HTTPURLResponse?) {
        var r = URLRequest(url: url)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(RecorderIdentity.userAgent, forHTTPHeaderField: "User-Agent")
        r.httpBody = body.serializedData()
        let (data, response) = try await session.data(for: r)
        let http = response as? HTTPURLResponse
        return (http?.statusCode ?? 0, data, http)
    }

    /// Ask the server for a link code. The body stays `{kind, label}`; the
    /// server refuses unknown fields there.
    package static func start(base: URL, label: String, session: URLSession) async throws -> LinkStart {
        let origin = origin(of: base)
        let workspace = workspace(of: base)
        let (status, data, _) = try await post(session, URL(string: origin + "/api/v1/cli/auth")!, ["kind": "recorder", "label": .string(label)])
        guard status == 201 || status == 200 else { throw DeviceLinkError.refused(status: status) }
        guard let w = try? JSONValue.parse(data), w.objectValue != nil else { throw DeviceLinkError.malformed("not JSON") }
        func req(_ key: String) throws -> String {
            guard let v = w[key]?.stringValue, !v.isEmpty else { throw DeviceLinkError.malformed(key) }
            return v
        }
        let deviceCode = try req("device_code")
        let userCode = try req("user_code")
        let verifyPath = try req("verify_path")
        let qrPath = try req("qr_path")
        let code = userCode.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? userCode
        return LinkStart(
            deviceCode: deviceCode,
            userCode: userCode,
            verifyURL: withWorkspace(sameOriginURL(origin, w["verify_url"]?.stringValue, verifyPath, "/cli-auth?code=\(code)"), workspace),
            qrURL: withWorkspace(sameOriginURL(origin, qrPath, qrPath, "/cli-auth/qr?code=\(code)"), workspace),
            interval: max(2, w["interval"]?.intValue ?? 2),
            expiresIn: w["expires_in"]?.intValue ?? 0
        )
    }

    /// Claim until approved. Transient failures (transport errors, 5xx, 408,
    /// 429) back off and retry until the code expires; 404/410 is `expired`;
    /// a claim pinned to another workspace is `workspaceMismatch` and the
    /// token is discarded unstored. Cancel the task to stop polling.
    package static func poll(
        base: URL,
        start: LinkStart,
        session: URLSession,
        sleep: @Sendable (Double) async throws -> Void = { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
        now: @Sendable () -> Date = { Date() }
    ) async throws -> LinkedToken {
        let origin = origin(of: base)
        let workspace = workspace(of: base)
        let interval = Double(max(2, start.interval))
        let deadline = now().addingTimeInterval(Double(start.expiresIn > 0 ? start.expiresIn : 600))
        var failures = 0
        func backOff(retryAfter: Double?) async throws {
            failures += 1
            let left = deadline.timeIntervalSince(now())
            if left <= 0 { throw DeviceLinkError.expired }
            let wait = max(min(30, interval * pow(2, Double(failures))), retryAfter ?? 0)
            try await sleep(min(wait, left))
        }
        let claimURL = URL(string: origin + "/api/v1/cli/auth/claim")!
        while true {
            try Task.checkCancellation()
            let status: Int
            let data: Data
            let http: HTTPURLResponse?
            do {
                (status, data, http) = try await post(session, claimURL, ["device_code": .string(start.deviceCode)])
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                try Task.checkCancellation()
                try await backOff(retryAfter: nil)
                continue
            }
            if status >= 500 || status == 408 || status == 429 {
                let ra = http?.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
                try await backOff(retryAfter: ra)
                continue
            }
            failures = 0
            if status == 200 {
                guard let w = try? JSONValue.parse(data), let token = w["token"]?.stringValue, !token.isEmpty else {
                    throw DeviceLinkError.malformed("token")
                }
                let linkedWorkspace = w["workspace"]?.stringValue ?? ""
                if let workspace, linkedWorkspace != workspace {
                    throw DeviceLinkError.workspaceMismatch(linked: linkedWorkspace.isEmpty ? "(no workspace)" : linkedWorkspace, expected: workspace)
                }
                return LinkedToken(
                    token: token, workspace: linkedWorkspace, label: w["label"]?.stringValue ?? "",
                    expiresIn: w["expires_in"]?.intValue ?? 0, linkedAt: now()
                )
            }
            if status == 404 || status == 410 { throw DeviceLinkError.expired }
            if status != 202 { throw DeviceLinkError.refused(status: status) }
            try await sleep(interval)
        }
    }
}
#endif
