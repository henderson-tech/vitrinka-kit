#if DEBUG
import Foundation
import OSLog
import VitrinkaRecorderCore

/// One unified-log entry the console lane forwards.
struct ConsoleLine: Sendable, Equatable {
    var date: Date
    /// "error" for error and fault entries (the projection lists `error`
    /// lines as the screen's failures), else "log".
    var level: String
    var osLevel: String
    var text: String
    var subsystem: String
    var category: String
    /// A summary: how many more times the same line came in its window.
    var repeats: Int?
    /// The marker sent once when the session's console budget is spent.
    var capped = false
}

/// Keeps one chatty line from flooding the board's failures.
///
/// A line whose (subsystem, category, text with digit runs as `#`) matches
/// one sent in the last 60 s is not sent again; when that window closes (or
/// at Stop) one summary goes out with the first line's fields and
/// `repeats: N`. A session sends at most 200 console entries, then one
/// "console lane capped" marker and nothing more.
struct ConsoleCollapser: Sendable {
    static let window: TimeInterval = 60
    static let sessionCap = 200

    private struct Open: Sendable {
        var first: ConsoleLine
        var opened: Date
        var repeats: Int
        var lastAt: Date
    }

    private var open: [String: Open] = [:]
    private var order: [String] = []
    private(set) var sent = 0
    private(set) var capped = false

    static func key(_ l: ConsoleLine) -> String {
        var normal = ""
        var inDigits = false
        for u in l.text.unicodeScalars {
            if CharacterSet.decimalDigits.contains(u) {
                if !inDigits { normal += "#" }
                inDigits = true
            } else {
                normal.unicodeScalars.append(u)
                inDigits = false
            }
        }
        return "\(l.subsystem)\u{1F}\(l.category)\u{1F}\(normal)"
    }

    /// Take one line; returns what to send now (summaries of windows that
    /// closed before it, then the line itself unless it repeats).
    mutating func admit(_ line: ConsoleLine) -> [ConsoleLine] {
        var out = expire(now: line.date)
        let k = Self.key(line)
        if var o = open[k] {
            o.repeats += 1
            o.lastAt = line.date
            open[k] = o
            return out
        }
        open[k] = Open(first: line, opened: line.date, repeats: 0, lastAt: line.date)
        order.append(k)
        out += budget([line])
        return out
    }

    /// Summaries of the windows that closed by `now`.
    mutating func expire(now: Date) -> [ConsoleLine] {
        var due: [ConsoleLine] = []
        for k in order {
            guard let o = open[k], now.timeIntervalSince(o.opened) >= Self.window else { continue }
            open[k] = nil
            if o.repeats > 0 { due.append(summary(o)) }
        }
        order.removeAll { open[$0] == nil }
        return budget(due)
    }

    /// Stop: the summaries of every open window.
    mutating func drain() -> [ConsoleLine] {
        let due = order.compactMap { k -> ConsoleLine? in
            guard let o = open[k], o.repeats > 0 else { return nil }
            return summary(o)
        }
        open = [:]
        order = []
        return budget(due)
    }

    private func summary(_ o: Open) -> ConsoleLine {
        var s = o.first
        s.date = o.lastAt
        s.repeats = o.repeats
        return s
    }

    private mutating func budget(_ lines: [ConsoleLine]) -> [ConsoleLine] {
        var out: [ConsoleLine] = []
        for l in lines {
            if capped { break }
            if sent >= Self.sessionCap {
                capped = true
                out.append(ConsoleLine(date: l.date, level: "log", osLevel: "default",
                                       text: "console lane capped at \(Self.sessionCap) entries; later lines of this session are not recorded",
                                       subsystem: "", category: "", repeats: nil, capped: true))
                break
            }
            sent += 1
            out.append(l)
        }
        return out
    }
}

/// The console lane: polls this process's own unified log
/// (`OSLogStore(scope: .currentProcessIdentifier)`, no entitlement) every 2 s
/// while recording, off the main thread. The recorder's own subsystem is
/// always skipped, so a failing upload cannot log itself into the stream.
actor ConsoleLane {
    nonisolated static let textCap = 8 * 1024

    private let filter: VitrinkaRecorderConfiguration.LogCapture
    private let own: [String]
    private let deliver: @Sendable ([ConsoleLine]) async -> Void
    private var store: OSLogStore?
    private var since = Date()
    private var seenAtSince = Set<Int>()
    private var task: Task<Void, Never>?
    private var collapser = ConsoleCollapser()

    /// `own`: the app's own subsystems (see `ownSubsystems`).
    init(filter: VitrinkaRecorderConfiguration.LogCapture, own: [String], deliver: @escaping @Sendable ([ConsoleLine]) async -> Void) {
        self.filter = filter
        self.own = own
        self.deliver = deliver
    }

    /// The bundle id and the app id, each also without a trailing build
    /// flavour (`dev.example.app.debug` → `dev.example.app`).
    nonisolated static func ownSubsystems(bundleID: String?, appID: String) -> [String] {
        let flavours: Set<String> = ["debug", "dev", "development", "staging", "beta", "test", "qa"]
        var out: [String] = []
        for id in [bundleID, appID].compactMap({ $0 }) where !id.isEmpty {
            out.append(id)
            var parts = id.split(separator: ".")
            if parts.count > 2, let last = parts.last, flavours.contains(last.lowercased()) {
                parts.removeLast()
                out.append(parts.joined(separator: "."))
            }
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /// Start polling. `newSession` resets the repeat windows and the
    /// session's budget (a resume keeps them).
    func start(from date: Date, newSession: Bool) {
        guard filter.enabled else { return }
        if newSession { collapser = ConsoleCollapser() }
        since = date
        seenAtSince = []
        task?.cancel()
        task = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { break }
                let lines = self.poll()
                if !lines.isEmpty { await self.deliver(lines) }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    /// Stop: the summaries of every open repeat window.
    func drainRepeats() -> [ConsoleLine] {
        collapser.drain()
    }

    /// Read entries since the last poll that pass the filter, with repeats
    /// collapsed.
    func poll() -> [ConsoleLine] {
        var out = collapser.expire(now: Date())
        for line in read() { out += collapser.admit(line) }
        return out
    }

    private func read() -> [ConsoleLine] {
        do {
            if store == nil { store = try OSLogStore(scope: .currentProcessIdentifier) }
            guard let store else { return [] }
            let entries = try store.getEntries(at: store.position(date: since))
            var out: [ConsoleLine] = []
            var newest = since
            var seenAtNewest = seenAtSince
            for case let e as OSLogEntryLog in entries {
                if e.date < since { continue }
                let key = e.composedMessage.hashValue ^ e.date.hashValue
                if e.date == since, seenAtSince.contains(key) { continue }
                if e.date > newest {
                    newest = e.date
                    seenAtNewest = []
                }
                if e.date == newest { seenAtNewest.insert(key) }
                guard let line = Self.accept(e, filter: filter, own: own) else { continue }
                out.append(line)
            }
            since = newest
            seenAtSince = seenAtNewest
            return out
        } catch {
            return []
        }
    }

    nonisolated static func accept(_ e: OSLogEntryLog, filter: VitrinkaRecorderConfiguration.LogCapture, own: [String]) -> ConsoleLine? {
        let osLevel: String
        switch e.level {
        case .fault: osLevel = "fault"
        case .error: osLevel = "error"
        case .notice: osLevel = "notice"
        case .info: osLevel = "info"
        case .debug: osLevel = "debug"
        default: osLevel = "default"
        }
        let isError = e.level == .error || e.level == .fault
        let text = e.composedMessage
        guard keep(subsystem: e.subsystem, isError: isError, osLevel: osLevel, text: text, filter: filter, own: own) else { return nil }
        return ConsoleLine(
            date: e.date, level: isError ? "error" : "log", osLevel: osLevel,
            text: String(text.prefix(textCap)), subsystem: e.subsystem, category: e.category
        )
    }

    /// The filter rule, separate for tests.
    nonisolated static func keep(
        subsystem: String, isError: Bool, osLevel: String, text: String,
        filter: VitrinkaRecorderConfiguration.LogCapture, own: [String]
    ) -> Bool {
        guard filter.enabled, osLevel != "debug" else { return false }
        if subsystem == RecorderLog.subsystem || subsystem.hasPrefix(RecorderLog.subsystem + ".") { return false }
        if subsystem.isEmpty {
            // No subsystem: framework noise (CoreAudio, caches) unless the host
            // names its own NSLog prefix.
            return filter.unlabelledPrefixes.contains { text.hasPrefix($0) }
        }
        let mine = (own + filter.subsystems).contains { !$0.isEmpty && (subsystem == $0 || subsystem.hasPrefix($0 + ".")) }
        return mine && (isError || filter.allLevels)
    }
}
#endif
