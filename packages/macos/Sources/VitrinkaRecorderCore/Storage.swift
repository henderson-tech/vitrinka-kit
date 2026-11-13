#if DEBUG
import Foundation

// On-device storage, all under one directory the host app owns
// (`~/Library/Application Support/<bundle id>/VitrinkaRecorder/`):
//
//   session.json      the live SessionState (survives a relaunch)
//   buffer.json       undelivered events (debounced, and before every POST)
//   pending.json      shots waiting for their upload, with pending/<seq>.jpg
//   link.json         the device-link token, mode 0600
//
// The tail is removed once delivered or when the session ends locally.

/// The durable session record.
package struct SessionState: Codable, Sendable, Equatable {
    package var sessionId: String
    package var project: String
    package var environment: String
    package var title: String
    package var appID: String
    /// The last allocated seq.
    package var seq: Int
    package var paused: Bool
    /// elapsed = activeMs + (now − resumeAt while running).
    package var activeMs: Double
    package var resumeAt: Date?
    /// Keyframes captured in this session (the HUD's frame count).
    package var shots: Int
    /// The server will not accept this session's events any more.
    package var dead: Bool
    package var deadReason: String?
    package var driver: String
    /// The fetched workspace policy (its JSON), once the fetch settled.
    package var policyJSON: String?
    /// True once the policy fetch settled (nil policy = the safe defaults).
    package var policySettled: Bool
    package var startedAt: Date
    /// Set when the session was recovered after a relaunch.
    package var recovered: Bool

    package func elapsedMs(now: Date = Date()) -> Double {
        var ms = activeMs
        if !paused, let resumeAt { ms += now.timeIntervalSince(resumeAt) * 1000 }
        return ms
    }
}

/// A captured keyframe waiting for its upload. It keeps its seq: a late
/// upload fills the stream's gap.
package struct PendingShot: Codable, Sendable, Equatable {
    package var seq: Int
    package var ts: String
    package var lane: Lane
    package var sessionId: String
    /// The shot event's payload, serialized.
    package var payloadJSON: String
    package var file: String
    package var mime: String
}

/// Atomic, permission-aware file writes.
package enum SecureFile {
    /// Write `data` atomically with the given POSIX mode from creation on
    /// (no window in which a token file is world-readable).
    package static func write(_ data: Data, to url: URL, mode: mode_t) throws {
        let dir = url.deletingLastPathComponent()
        let tmp = dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
        let fd = open(tmp.path, O_WRONLY | O_CREAT | O_EXCL, mode)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        var ok = true
        data.withUnsafeBytes { buf in
            var off = 0
            while off < buf.count {
                let n = Darwin.write(fd, buf.baseAddress! + off, buf.count - off)
                if n <= 0 { ok = false; break }
                off += n
            }
        }
        fchmod(fd, mode)
        close(fd)
        guard ok else {
            unlink(tmp.path)
            throw POSIXError(.EIO)
        }
        guard rename(tmp.path, url.path) == 0 else {
            let code = errno
            unlink(tmp.path)
            throw POSIXError(POSIXErrorCode(rawValue: code) ?? .EIO)
        }
    }
}

/// The device-link token file (`link.json`, mode 0600).
package final class LinkStore: Sendable {
    package let url: URL

    package init(directory: URL) {
        url = directory.appendingPathComponent("link.json")
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    package func read() -> LinkedToken? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        guard let link = try? d.decode(LinkedToken.self, from: data), !link.token.isEmpty else { return nil }
        return link
    }

    package func write(_ link: LinkedToken) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try SecureFile.write(Self.encoder.encode(link), to: url, mode: 0o600)
    }

    package func remove() {
        unlink(url.path)
    }
}

/// The session files.
package final class RecorderStore: Sendable {
    package let directory: URL
    package var pendingDirectory: URL { directory.appendingPathComponent("pending", isDirectory: true) }
    private var sessionURL: URL { directory.appendingPathComponent("session.json") }
    private var bufferURL: URL { directory.appendingPathComponent("buffer.json") }
    private var pendingURL: URL { directory.appendingPathComponent("pending.json") }

    package init(directory: URL) {
        self.directory = directory
    }

    package func ensureDirectories() {
        let fm = FileManager.default
        try? fm.createDirectory(at: pendingDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }

    private static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        e.outputFormatting = [.sortedKeys]
        return e
    }

    private static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }

    private func put(_ data: Data, _ url: URL) {
        ensureDirectories()
        do {
            try SecureFile.write(data, to: url, mode: 0o600)
        } catch {
            RecorderLog.engine.error("vitrinka: cannot write \(url.lastPathComponent, privacy: .public): \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: session.json

    package func loadSession() -> SessionState? {
        guard let data = try? Data(contentsOf: sessionURL) else { return nil }
        return try? Self.decoder().decode(SessionState.self, from: data)
    }

    package func saveSession(_ s: SessionState?) {
        guard let s else {
            unlink(sessionURL.path)
            return
        }
        guard let data = try? Self.encoder().encode(s) else { return }
        put(data, sessionURL)
    }

    // MARK: buffer.json

    package func loadBuffer() -> [RecorderEvent] {
        guard let data = try? Data(contentsOf: bufferURL), let json = try? JSONValue.parse(data), let arr = json.arrayValue else { return [] }
        return arr.compactMap(RecorderEvent.init(json:))
    }

    package func saveBuffer(_ events: [RecorderEvent]) {
        put(JSONValue.array(events.map(\.json)).serializedData(), bufferURL)
    }

    // MARK: pending

    package func loadPending() -> [PendingShot] {
        guard let data = try? Data(contentsOf: pendingURL) else { return [] }
        return (try? Self.decoder().decode([PendingShot].self, from: data)) ?? []
    }

    package func savePending(_ items: [PendingShot]) {
        guard let data = try? Self.encoder().encode(items) else { return }
        put(data, pendingURL)
    }

    package func shotURL(_ file: String) -> URL { pendingDirectory.appendingPathComponent(file) }

    package func writeShot(_ data: Data, seq: Int, ext: String) throws -> String {
        ensureDirectories()
        let name = "\(seq).\(ext)"
        try SecureFile.write(data, to: shotURL(name), mode: 0o600)
        return name
    }

    package func readShot(_ file: String) -> Data? { try? Data(contentsOf: shotURL(file)) }

    package func deleteShot(_ file: String) { unlink(shotURL(file).path) }

    /// Remove every shot file (a fresh session or a session ended locally).
    package func sweepShots() {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: pendingDirectory.path)) ?? []
        for n in names { unlink(shotURL(n).path) }
    }
}

/// The credential ladder: `VITRINKA_RECORDER_TOKEN` in the environment, else
/// the user default `VitrinkaRecorderToken` (debug hosts launched without a
/// shell environment), else the device-link token in `link.json`.
package struct CredentialLadder: Sendable {
    package var environment: [String: String]
    package var userDefault: @Sendable () -> String?
    package var link: LinkStore
    package var useEnvironment: Bool

    package init(environment: [String: String], userDefault: @escaping @Sendable () -> String?, link: LinkStore, useEnvironment: Bool = true) {
        self.environment = environment
        self.userDefault = userDefault
        self.link = link
        self.useEnvironment = useEnvironment
    }

    package func resolve() -> ResolvedCredential? {
        if useEnvironment {
            if let t = environment["VITRINKA_RECORDER_TOKEN"]?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
                return ResolvedCredential(token: t, source: .environment)
            }
            if let t = userDefault()?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty {
                return ResolvedCredential(token: t, source: .userDefaults)
            }
        }
        if let l = link.read() { return ResolvedCredential(token: l.token, source: .deviceLink) }
        return nil
    }
}
#endif
