#if DEBUG
import Foundation

// The recorder↔server wire contract, mirrored from
// packages/expo/src/protocol/index.ts, with the details the server at
// vitrinka 5.27.0 proved:
//
// - the events body is an object `{"events":[...]}` (a bare array is a 400);
// - a `shot` event carries the `blobKey` its `/shot?seq=N` upload answered,
//   as a top-level field (the projection skips a shot without one);
// - a session id is a JSON number on the server, a string here;
// - `PATCH {status:"done"}` answers `projection.state: "queued"`; the board
//   URL is the top-level `boardUrl` of `GET /sessions/:id` once
//   `projection.state` is "ready".

/// The recorder's identity on the wire. `meta.recorder` is `macos/<version>`.
package enum RecorderIdentity {
    package static let version = "0.1.0"
    package static var recorderMeta: String { "macos/\(version)" }
    /// The release-binary canary. It rides in every request's User-Agent, so
    /// the linker keeps it whenever the live recorder is linked, and
    /// `check-release-binary.sh` fails a binary that contains it.
    package static let canary = "vitrinka-macos-live/1"
    package static var userAgent: String { "VitrinkaRecorder/\(version) (\(canary))" }
}

/// One captured event in a session's ordered stream.
package struct RecorderEvent: Sendable, Equatable {
    /// Recorder-allocated, strictly increasing; the delivery-ack unit.
    package var seq: Int
    /// ISO-8601 timestamp (milliseconds, UTC) at capture.
    package var ts: String
    /// Timeline lane: one per top-level window.
    package var tabId: String
    /// The route path the event happened on.
    package var tabHost: String
    package var kind: String
    package var payload: JSONObject?
    /// Server blob reference for `shot` events (set after the upload).
    package var blobKey: String?

    package init(seq: Int, ts: String, tabId: String, tabHost: String, kind: String, payload: JSONObject? = nil, blobKey: String? = nil) {
        self.seq = seq
        self.ts = ts
        self.tabId = tabId
        self.tabHost = tabHost
        self.kind = kind
        self.payload = payload
        self.blobKey = blobKey
    }

    package var json: JSONValue {
        var o: JSONObject = [
            "seq": .number(Double(seq)),
            "ts": .string(ts),
            "tabId": .string(tabId),
            "tabHost": .string(tabHost),
            "kind": .string(kind),
        ]
        if let payload { o["payload"] = .object(payload) }
        if let blobKey { o["blobKey"] = .string(blobKey) }
        return .object(o)
    }

    package init?(json: JSONValue) {
        guard let seq = json["seq"]?.intValue, let ts = json["ts"]?.stringValue, let kind = json["kind"]?.stringValue else {
            return nil
        }
        self.init(
            seq: seq, ts: ts,
            tabId: json["tabId"]?.stringValue ?? "",
            tabHost: json["tabHost"]?.stringValue ?? "",
            kind: kind,
            payload: json["payload"]?.objectValue,
            blobKey: json["blobKey"]?.stringValue
        )
    }
}

/// Where an event happened: its window lane and route path.
package struct Lane: Sendable, Equatable, Codable {
    package var tabId: String
    package var tabHost: String
    package init(tabId: String, tabHost: String) {
        self.tabId = tabId
        self.tabHost = tabHost
    }
}

package struct SessionCreated: Sendable, Equatable {
    package var id: String
    package var project: String
    package var environment: String
    package var title: String

    package init?(json: JSONValue) {
        // The server's id is an int64; a string is accepted too.
        guard let id = json["id"]?.intValue.map(String.init) ?? json["id"]?.stringValue else { return nil }
        self.id = id
        project = json["project"]?.stringValue ?? ""
        environment = json["environment"]?.stringValue ?? ""
        title = json["title"]?.stringValue ?? ""
    }
}

/// `GET /api/v1/sessions/:id`: the reconcile poll and the board poll.
package struct SessionRow: Sendable, Equatable {
    package var maxSeq: Int?
    package var status: String?
    package var deleted: Bool
    package var projectionState: String?
    package var projectionError: String?
    package var boardSlug: String?
    package var boardURL: URL?

    package init(json: JSONValue) {
        maxSeq = json["maxSeq"]?.intValue
        status = json["status"]?.stringValue
        if let d = json["deletedAt"], d != .null, d != .string("") { deleted = true } else { deleted = false }
        projectionState = json["projection"]?["state"]?.stringValue
        projectionError = json["projection"]?["error"]?.stringValue
        let slug = json["boardSlug"]?.stringValue ?? ""
        boardSlug = slug.isEmpty ? nil : slug
        // 5.27.0 answers a top-level `boardUrl`; the Expo protocol types name
        // `board.url`, so both are read.
        let url = json["boardUrl"]?.stringValue ?? json["board"]?["url"]?.stringValue ?? ""
        boardURL = url.isEmpty ? nil : URL(string: url)
    }
}

/// `GET /api/v1/recorder/policy`.
package struct PolicyAnswer: Sendable, Equatable {
    /// nil when the body had no `policy` key: out of contract, so the safe
    /// defaults apply (REDACTION-SPEC "The policy document").
    package var policy: RedactionPolicy?
    package var attachments: Bool

    package init(json: JSONValue) {
        if let p = json["policy"] {
            policy = p == .null ? RedactionPolicy() : RedactionPolicy(json: p)
        } else {
            policy = nil
        }
        attachments = json["attachments"]?.boolValue == true
    }
}

/// ISO-8601 with milliseconds in UTC, as JavaScript's `toISOString()`.
package enum Timestamp {
    package static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    package static func parse(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
#endif
