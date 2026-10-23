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
}

/// The console lane: polls this process's own unified log
/// (`OSLogStore(scope: .currentProcessIdentifier)`, no entitlement) every 2 s
/// while recording, off the main thread. The recorder's own subsystem is
/// always skipped, so a failing upload cannot log itself into the stream.
actor ConsoleLane {
    nonisolated static let textCap = 8 * 1024

    private let filter: VitrinkaRecorderConfiguration.LogCapture
    private let deliver: @Sendable ([ConsoleLine]) async -> Void
    private var store: OSLogStore?
    private var since = Date()
    private var seenAtSince = Set<Int>()
    private var task: Task<Void, Never>?

    init(filter: VitrinkaRecorderConfiguration.LogCapture, deliver: @escaping @Sendable ([ConsoleLine]) async -> Void) {
        self.filter = filter
        self.deliver = deliver
    }

    func start(from date: Date) {
        if case .off = filter { return }
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

    /// Read entries since the last poll that pass the filter.
    func poll() -> [ConsoleLine] {
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
                guard let line = Self.accept(e, filter: filter) else { continue }
                out.append(line)
            }
            since = newest
            seenAtSince = seenAtNewest
            return out
        } catch {
            return []
        }
    }

    nonisolated static func accept(_ e: OSLogEntryLog, filter: VitrinkaRecorderConfiguration.LogCapture) -> ConsoleLine? {
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
        guard keep(subsystem: e.subsystem, isError: isError, osLevel: osLevel, filter: filter) else { return nil }
        return ConsoleLine(
            date: e.date, level: isError ? "error" : "log", osLevel: osLevel,
            text: String(e.composedMessage.prefix(textCap)), subsystem: e.subsystem, category: e.category
        )
    }

    /// The filter rule, separate for tests.
    nonisolated static func keep(subsystem: String, isError: Bool, osLevel: String, filter: VitrinkaRecorderConfiguration.LogCapture) -> Bool {
        if subsystem == RecorderLog.subsystem || subsystem.hasPrefix(RecorderLog.subsystem + ".") { return false }
        switch filter {
        case .off:
            return false
        case .errors:
            return isError && !subsystem.hasPrefix("com.apple.")
        case let .all(subsystems):
            if isError && !subsystem.hasPrefix("com.apple.") { return true }
            return osLevel != "debug" && subsystems.contains(subsystem)
        }
    }
}
#endif
