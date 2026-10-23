#if DEBUG
import Foundation

// The session lifecycle and the durable queue: a port of the Expo recorder's
// session.ts + queue.ts semantics into one actor, so every read-modify-write
// is serialized (the Swift form of Expo's "synchronous KV" rule).
//
// - start: POST /sessions {app, title, meta}; the policy fetch runs beside it
//   and never blocks it (the safe defaults apply until it lands).
// - capture: events get a per-session seq; a shot is written to disk with a
//   seq, uploaded first, and only then does its `shot` event (with the
//   answered blobKey) join the stream. A failed upload keeps its seq.
// - flush every 2 s: pending shots first, then batches of at most 500 events
//   and 3 MiB; a transient failure backs off (2 s · 2^(n−1), cap 300 s, ±25%).
// - reconcile every 10 s: 404, status done, deletedAt or a permanent 4xx
//   marks the session dead (a 401 forgets a device link).
// - stop: drain for up to 60 s; offline it throws and keeps the tail (the
//   session pauses: "stop again once online"); then PATCH done and poll
//   GET /sessions/:id until projection.state is "ready" for the board URL.
// - relaunch: the session is recovered from session.json, paused.

package struct EngineConfig: Sendable {
    package var appID: String
    package var appVersion: String?
    package var osVersion: String
    package var devicePixelRatio: Double
    package var directory: URL
    /// nil disables the timer (tests drive flush() directly).
    package var flushInterval: Double? = 2
    package var reconcileInterval: Double? = 10
    package var persistDebounce: Double = 0.7
    package var drainDeadline: Double = 60
    package var drainRetryPause: Double = 1
    package var boardPollDeadline: Double = 30
    package var boardPollInterval: Double = 0.5
    package var maxBufferedEvents = 20_000
    package var maxPendingShots = 200
    package var backoffBase: Double = 2
    package var backoffCap: Double = 300

    package init(appID: String, appVersion: String?, osVersion: String, devicePixelRatio: Double, directory: URL) {
        self.appID = appID
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.devicePixelRatio = devicePixelRatio
        self.directory = directory
    }
}

/// Byte budgets for one events POST (mirrors queue.ts).
package enum Batching {
    package static let maxEvents = 500
    package static let wireBodyCap = 4 * 1024 * 1024
    package static let maxBatchBytes = 3 * 1024 * 1024
    package static let maxEventBytes = wireBodyCap - 1024
}

package enum RecorderEngineError: Error, Sendable, Equatable, CustomStringConvertible {
    case alreadyRecording
    case notRecording
    case notLinked
    /// The server stayed unreachable for the whole drain; the tail is on disk.
    case offline(queued: Int)
    /// The server refused this session; the recording ended locally.
    case sessionDead(reason: String, discarded: Int)
    /// The token was rejected (401).
    case unauthorized

    package var description: String {
        switch self {
        case .alreadyRecording: return "a recording is already running"
        case .notRecording: return "no recording is running"
        case .notLinked: return "this Mac is not linked to vitrinka"
        case let .offline(queued): return "server unreachable — \(queued) item(s) kept on disk; stop again once online"
        case let .sessionDead(reason, discarded):
            return "\(reason) — recording ended locally" + (discarded > 0 ? "; \(discarded) undelivered item(s) discarded" : "")
        case .unauthorized: return "the recorder token was rejected (401) — link this Mac again"
        }
    }
}

package struct StopOutcome: Sendable, Equatable {
    package var sessionID: String
    /// The board, once the projection is ready; nil when it was not ready in
    /// time (or failed). The session is done on the server either way.
    package var boardURL: URL?
    package var projectionState: String?
}

package enum EngineNotice: Sendable, Equatable {
    case changed
    case dead(String)
    /// A 401: the session ended locally; a device link was forgotten.
    case unauthorized(CredentialSource?)
}

package enum HealthState: String, Sendable {
    case idle, ok, backlog, offline, dead
}

package struct EngineHealth: Sendable, Equatable {
    package var state: HealthState
    package var sessionID: String?
    package var paused: Bool
    package var recovered: Bool
    package var queued: Int
    package var failures: Int
    package var lastError: String
    package var localSeq: Int
    package var serverMaxSeq: Int
    package var synced: Bool
    package var shots: Int
    package var elapsedMs: Double
    package var deadReason: String?
}

/// The active redaction rules, readable from any thread (capture layers on
/// the main actor redact labels and titles before they push).
package final class RulesBox: @unchecked Sendable {
    private let lock = NSLock()
    private var current = RedactionRules.defaults

    package init() {}

    package var rules: RedactionRules {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    package func set(_ r: RedactionRules) {
        lock.lock()
        current = r
        lock.unlock()
    }
}

package actor RecorderEngine {
    package let config: EngineConfig
    package let api: VitrinkaAPI
    package let store: RecorderStore
    package let linkStore: LinkStore
    package nonisolated let rules: RulesBox

    private var state: SessionState?
    private var buffer: [RecorderEvent] = []
    private var pending: [PendingShot] = []
    private var closing = false
    private var flushBusy = false

    // Health (extension D4): honest by construction.
    private var lastSyncAt: Date?
    private var lastError = ""
    private var failures = 0
    private var serverMaxSeq = -1
    private var nextAttemptAt = Date.distantPast

    private var flushTask: Task<Void, Never>?
    private var reconcileTask: Task<Void, Never>?
    private var persistTask: Task<Void, Never>?
    private var noticeHandler: (@Sendable (EngineNotice) -> Void)?
    private let jitter: @Sendable () -> Double

    package init(config: EngineConfig, api: VitrinkaAPI, rules: RulesBox = RulesBox(), jitter: @escaping @Sendable () -> Double = { Double.random(in: 0.75 ... 1.25) }) {
        self.config = config
        self.api = api
        store = RecorderStore(directory: config.directory)
        linkStore = LinkStore(directory: config.directory)
        self.rules = rules
        self.jitter = jitter
    }

    package func setNoticeHandler(_ h: (@Sendable (EngineNotice) -> Void)?) {
        noticeHandler = h
    }

    private func notify(_ n: EngineNotice = .changed) {
        noticeHandler?(n)
    }

    // MARK: - Lifecycle

    package var session: SessionState? { state }

    /// Recover a session left by a previous run. It comes back paused; its
    /// undelivered tail starts uploading at once.
    @discardableResult
    package func recover() -> SessionState? {
        guard state == nil, var s = store.loadSession() else { return state }
        buffer = store.loadBuffer()
        pending = store.loadPending().filter { $0.sessionId == s.sessionId }
        let maxBuffered = buffer.map(\.seq).max() ?? 0
        let maxPending = pending.map(\.seq).max() ?? 0
        s.seq = max(s.seq, maxBuffered, maxPending)
        if !s.paused {
            s.activeMs = s.elapsedMs()
            s.paused = true
            s.resumeAt = nil
        }
        s.recovered = true
        state = s
        applyStoredPolicy(s)
        store.saveSession(s)
        resetHealth(baseSeq: 0)
        armTimers()
        if !s.policySettled { refetchPolicy(for: s.sessionId) }
        notify()
        return s
    }

    package func start(title: String, environment: String? = nil, driver: String = "human") async throws -> SessionState {
        guard state == nil else { throw RecorderEngineError.alreadyRecording }
        rules.set(.defaults)
        var meta: JSONObject = [
            "recorder": .string(RecorderIdentity.recorderMeta),
            "platform": "macos",
        ]
        if let v = config.appVersion { meta["appVersion"] = .string(v) }
        meta["osVersion"] = .string(config.osVersion)
        meta["devicePixelRatio"] = .number(config.devicePixelRatio)
        meta["driver"] = .string(driver)
        var body: JSONObject = ["app": .string(config.appID), "title": .string(title)]
        if let environment, !environment.isEmpty { body["environment"] = .string(environment) }
        body["meta"] = .object(meta)
        let answer: JSONValue
        do {
            answer = try await api.json("POST", "/api/v1/sessions", body: .object(body))
        } catch let e as VitrinkaAPIError where e.isUnauthorized {
            handleUnauthorized(e.credentialSource)
            throw RecorderEngineError.unauthorized
        }
        guard let created = SessionCreated(json: answer) else {
            throw VitrinkaAPIError(status: 502, message: "session create: answer has no id", credentialSource: nil)
        }
        let now = Date()
        let s = SessionState(
            sessionId: created.id, project: created.project, environment: created.environment, title: created.title,
            appID: config.appID, seq: 0, paused: false, activeMs: 0, resumeAt: now, shots: 0, dead: false,
            deadReason: nil, driver: driver, policyJSON: nil, policySettled: false, startedAt: now, recovered: false
        )
        state = s
        closing = false
        buffer = []
        pending = []
        store.sweepShots()
        store.saveBuffer([])
        store.savePending([])
        store.saveSession(s)
        resetHealth(baseSeq: 0)
        armTimers()
        refetchPolicy(for: s.sessionId)
        notify()
        return s
    }

    /// Fetch the workspace policy and apply it while this session is current.
    /// Never fails: a failure means the safe defaults (fail closed).
    private func refetchPolicy(for sessionID: String) {
        Task { [api] in
            var policy: RedactionPolicy?
            do {
                policy = PolicyAnswer(json: try await api.json("GET", "/api/v1/recorder/policy")).policy
            } catch {
                RecorderLog.engine.error("vitrinka: redaction policy fetch failed — using safe defaults")
            }
            self.applyPolicy(policy, for: sessionID)
        }
    }

    private func applyPolicy(_ policy: RedactionPolicy?, for sessionID: String) {
        guard var s = state, s.sessionId == sessionID, !s.policySettled else { return }
        rules.set(RedactionRules(policy: policy))
        s.policyJSON = policy?.json.serialized()
        s.policySettled = true
        state = s
        store.saveSession(s)
    }

    private func applyStoredPolicy(_ s: SessionState) {
        if let raw = s.policyJSON, let json = try? JSONValue.parse(raw) {
            rules.set(RedactionRules(policy: RedactionPolicy(json: json)))
        } else {
            rules.set(.defaults)
        }
    }

    package func setPaused(_ paused: Bool) async {
        guard var s = state, !s.dead, s.paused != paused else { return }
        let now = Date()
        if paused {
            s.activeMs = s.elapsedMs(now: now)
            s.resumeAt = nil
        } else {
            s.resumeAt = now
            s.recovered = false
        }
        s.paused = paused
        state = s
        store.saveSession(s)
        notify()
        do {
            try await api.json("PATCH", "/api/v1/sessions/\(s.sessionId)", body: ["status": .string(paused ? "paused" : "recording")])
        } catch let e as VitrinkaAPIError {
            if e.isUnauthorized { handleUnauthorized(e.credentialSource) }
            RecorderLog.engine.error("vitrinka: pause PATCH failed: \(e.description, privacy: .public)")
        } catch {}
    }

    // MARK: - Capture side

    /// Append an event. Dropped (nil) with no live session, while paused,
    /// on a dead session, or once Stop is closing it. Returns the stamped ts.
    @discardableResult
    package func push(_ kind: String, payload: JSONObject?, lane: Lane, at date: Date = Date()) -> String? {
        guard var s = state, !s.paused, !s.dead, !closing else { return nil }
        s.seq += 1
        state = s
        let ts = Timestamp.iso(date)
        buffer.append(RecorderEvent(seq: s.seq, ts: ts, tabId: lane.tabId, tabHost: lane.tabHost, kind: kind, payload: payload))
        if buffer.count > config.maxBufferedEvents {
            let dropped = buffer.count - config.maxBufferedEvents
            buffer.removeFirst(dropped)
            RecorderLog.engine.error("vitrinka: retry buffer full — dropped \(dropped) oldest events")
        }
        schedulePersist()
        return ts
    }

    /// Allocate a seq for a frame held for later (the annotate flow).
    package func reserveSeq() -> Int? {
        guard var s = state, !s.paused, !s.dead, !closing else { return nil }
        s.seq += 1
        state = s
        schedulePersist()
        return s.seq
    }

    /// Queue a captured keyframe: its bytes go to disk under a seq (a fresh
    /// one, or a reserved one) and upload ahead of the next events POST; its
    /// `shot` event joins the stream once the upload answered a blobKey.
    @discardableResult
    package func enqueueShot(_ data: Data, mime: String = "image/jpeg", lane: Lane, payload: JSONObject, at date: Date = Date(), reservedSeq: Int? = nil) -> Int? {
        guard var s = state, !s.dead else { return nil }
        let seq: Int
        if let reservedSeq {
            seq = reservedSeq
        } else {
            guard !s.paused, !closing else { return nil }
            s.seq += 1
            seq = s.seq
        }
        s.shots += 1
        state = s
        let ext = mime == "image/png" ? "png" : mime == "image/webp" ? "webp" : "jpg"
        let file: String
        do {
            file = try store.writeShot(data, seq: seq, ext: ext)
        } catch {
            RecorderLog.engine.error("vitrinka: cannot store shot seq \(seq): \(String(describing: error), privacy: .public)")
            return nil
        }
        pending.append(PendingShot(seq: seq, ts: Timestamp.iso(date), lane: lane, sessionId: s.sessionId,
                                   payloadJSON: JSONValue.object(payload).serialized(), file: file, mime: mime))
        while pending.count > config.maxPendingShots {
            let drop = pending.removeFirst()
            store.deleteShot(drop.file)
            RecorderLog.engine.error("vitrinka: pending upload queue full — dropped shot seq \(drop.seq)")
        }
        store.savePending(pending)
        store.saveSession(s)
        notify()
        kick()
        return seq
    }

    // MARK: - Persistence

    private func schedulePersist() {
        guard persistTask == nil else { return }
        let delay = config.persistDebounce
        persistTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.persistNow()
        }
    }

    /// Write the session and the buffer now (before every network call).
    package func persistNow() {
        persistTask?.cancel()
        persistTask = nil
        store.saveSession(state)
        if state != nil { store.saveBuffer(buffer) }
    }

    // MARK: - Flush

    private func armTimers() {
        flushTask?.cancel()
        reconcileTask?.cancel()
        if let every = config.flushInterval {
            flushTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: UInt64(every * 1_000_000_000))
                    if Task.isCancelled { break }
                    await self.tick()
                }
            }
        }
        armReconcile()
    }

    private func armReconcile() {
        reconcileTask?.cancel()
        guard let every = config.reconcileInterval else { return }
        reconcileTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(every * 1_000_000_000))
                if Task.isCancelled { break }
                await self.reconcile()
            }
        }
    }

    private func disarmTimers() {
        flushTask?.cancel()
        flushTask = nil
        reconcileTask?.cancel()
        reconcileTask = nil
    }

    private func tick() async {
        guard state != nil, !buffer.isEmpty || !pending.isEmpty, Date() >= nextAttemptAt else { return }
        _ = await flush()
    }

    /// Flush soon, unless the queue is backing off.
    private func kick() {
        guard config.flushInterval != nil, Date() >= nextAttemptAt else { return }
        Task { _ = await self.flush() }
    }

    /// The network came back: retry at once.
    package func resetBackoff() {
        nextAttemptAt = .distantPast
        kick()
    }

    package var queuedCount: Int { buffer.count + pending.count }

    /// Upload pending shots, then one events batch. Single-flight. True when
    /// the batch was accepted (or there was nothing to send).
    @discardableResult
    package func flush() async -> Bool {
        if flushBusy { return false }
        flushBusy = true
        defer { flushBusy = false }
        guard let s = state, !s.dead else { return false }
        persistNow()
        let pendingClear = await drainPending(limit: 5)
        guard let live = state, live.sessionId == s.sessionId, !live.dead else { return false }
        if buffer.isEmpty { return pendingClear }

        var batch: [RecorderEvent] = []
        var parts: [String] = []
        var oversized = Set<Int>()
        var bytes = 0
        for ev in buffer {
            if batch.count >= Batching.maxEvents { break }
            let text = ev.json.serialized()
            let b = text.utf8.count + 1
            if b > Batching.maxEventBytes {
                RecorderLog.engine.error("vitrinka: event seq \(ev.seq) (\(b) bytes) exceeds the wire cap — dropped")
                oversized.insert(ev.seq)
                continue
            }
            if b > Batching.maxBatchBytes {
                if batch.isEmpty {
                    batch.append(ev)
                    parts.append(text)
                    bytes = b
                }
                break
            }
            if !batch.isEmpty, bytes + b > Batching.maxBatchBytes { break }
            batch.append(ev)
            parts.append(text)
            bytes += b
        }
        if !oversized.isEmpty {
            buffer.removeAll { oversized.contains($0.seq) }
            persistNow()
            if batch.isEmpty { return false }
        }
        let body = Data(("{\"events\":[" + parts.joined(separator: ",") + "]}").utf8)
        do {
            try await api.raw("POST", "/api/v1/sessions/\(s.sessionId)/events", body: body)
        } catch let e as VitrinkaAPIError {
            if e.isUnauthorized {
                handleUnauthorized(e.credentialSource)
            } else if e.isPermanent {
                markDead("server rejected this session (\(e.status))")
            } else {
                noteFailure(e.description)
            }
            return false
        } catch {
            noteFailure(String(describing: error))
            return false
        }
        noteSync()
        if let top = batch.map(\.seq).max() { serverMaxSeq = max(serverMaxSeq, top) }
        let sent = Set(batch.map(\.seq))
        buffer.removeAll { sent.contains($0.seq) }
        persistNow()
        notify()
        return true
    }

    /// Upload queued shots oldest-first; each success adds its shot event
    /// (blobKey, original seq and ts) to the buffer. True when none are left.
    private func drainPending(limit: Int) async -> Bool {
        var done = 0
        while let item = pending.first, done < limit {
            done += 1
            guard let s = state, item.sessionId == s.sessionId else {
                RecorderLog.engine.error("vitrinka: dropping shot seq \(item.seq) from an ended session")
                dropPending(item)
                continue
            }
            guard let data = store.readShot(item.file) else {
                RecorderLog.engine.error("vitrinka: shot seq \(item.seq) file is gone — dropped")
                dropPending(item)
                continue
            }
            do {
                let key = try await api.uploadShot(sessionID: s.sessionId, seq: item.seq, data: data, mime: item.mime)
                guard state?.sessionId == item.sessionId else { return false }
                let payload = (try? JSONValue.parse(item.payloadJSON))?.objectValue
                buffer.append(RecorderEvent(seq: item.seq, ts: item.ts, tabId: item.lane.tabId, tabHost: item.lane.tabHost,
                                            kind: "shot", payload: payload, blobKey: key))
                noteSync()
                dropPending(item)
                persistNow()
            } catch let e as VitrinkaAPIError {
                if e.isUnauthorized {
                    handleUnauthorized(e.credentialSource)
                    return false
                }
                if e.isPermanent {
                    RecorderLog.engine.error("vitrinka: shot seq \(item.seq) rejected permanently (\(e.status)) — dropped")
                    dropPending(item)
                    continue
                }
                noteFailure(e.description)
                return false
            } catch {
                noteFailure(String(describing: error))
                return false
            }
        }
        return pending.isEmpty
    }

    private func dropPending(_ item: PendingShot) {
        store.deleteShot(item.file)
        pending.removeAll { $0.seq == item.seq && $0.sessionId == item.sessionId }
        store.savePending(pending)
    }

    /// Drain until the queue is empty or the deadline passes. A timed-out
    /// tail stays queued.
    package func drain(deadline seconds: Double? = nil) async -> Bool {
        let end = Date().addingTimeInterval(seconds ?? config.drainDeadline)
        while Date() < end {
            if buffer.isEmpty, pending.isEmpty { return true }
            let sent = await flush()
            if state?.dead != false { return false }
            if !sent {
                try? await Task.sleep(nanoseconds: UInt64(config.drainRetryPause * 1_000_000_000))
            }
        }
        if buffer.isEmpty, pending.isEmpty { return true }
        RecorderLog.engine.error("vitrinka: drain timed out — remaining events stay queued")
        return false
    }

    // MARK: - Health and reconcile

    private func noteSync() {
        lastSyncAt = Date()
        failures = 0
        lastError = ""
        nextAttemptAt = .distantPast
    }

    private func noteFailure(_ message: String) {
        failures += 1
        lastError = String(message.prefix(200))
        let delay = min(config.backoffCap, config.backoffBase * pow(2, Double(failures - 1))) * jitter()
        nextAttemptAt = Date().addingTimeInterval(delay)
        RecorderLog.engine.error("vitrinka: upload failed (\(self.failures)), retry in \(Int(delay))s: \(message, privacy: .public)")
        notify()
    }

    /// The backoff delay the queue waits now (for tests and the HUD).
    package var backoffRemaining: Double { max(0, nextAttemptAt.timeIntervalSinceNow) }

    private func resetHealth(baseSeq: Int) {
        lastSyncAt = Date()
        lastError = ""
        failures = 0
        serverMaxSeq = baseSeq
        nextAttemptAt = .distantPast
    }

    package func health(now: Date = Date()) -> EngineHealth {
        let queued = queuedCount
        let since = lastSyncAt.map { now.timeIntervalSince($0) }
        var st = HealthState.idle
        if let s = state {
            if s.dead { st = .dead }
            else if failures >= 2 || (queued > 0 && (since ?? 0) > 15) { st = .offline }
            else if queued > 40 { st = .backlog }
            else { st = .ok }
        }
        return EngineHealth(
            state: st, sessionID: state?.sessionId, paused: state?.paused ?? false, recovered: state?.recovered ?? false,
            queued: queued, failures: failures, lastError: lastError, localSeq: state?.seq ?? 0,
            serverMaxSeq: serverMaxSeq,
            synced: state.map { !$0.dead && serverMaxSeq >= $0.seq && queued == 0 } ?? false,
            shots: state?.shots ?? 0, elapsedMs: state?.elapsedMs(now: now) ?? 0,
            deadReason: state?.dead == true ? state?.deadReason : nil
        )
    }

    /// The server will not accept this session's events any more. The tail
    /// stays on disk until Stop settles it.
    private func markDead(_ reason: String) {
        guard var s = state, !s.dead else { return }
        s.dead = true
        s.deadReason = reason
        if !s.paused {
            s.activeMs = s.elapsedMs()
            s.resumeAt = nil
        }
        state = s
        store.saveSession(s)
        RecorderLog.engine.error("vitrinka: session marked dead — \(reason, privacy: .public)")
        notify(.dead(reason))
    }

    /// Ask the server what it holds and whether the session still exists.
    package func reconcile() async {
        guard let s = state, !s.dead else { return }
        let row: SessionRow
        do {
            row = SessionRow(json: try await api.json("GET", "/api/v1/sessions/\(s.sessionId)"))
        } catch let e as VitrinkaAPIError {
            if e.status == 404 {
                markDead("session no longer exists on the server")
            } else if e.isUnauthorized {
                handleUnauthorized(e.credentialSource)
            } else if e.isPermanent {
                markDead("server refused this session (\(e.status))")
            } else {
                noteFailure(e.description)
            }
            return
        } catch {
            return
        }
        guard var live = state, live.sessionId == s.sessionId else { return }
        noteSync()
        let held = row.maxSeq ?? 0
        serverMaxSeq = max(serverMaxSeq, held)
        // Never reuse a seq the server already holds (a crash between a POST
        // and the next persist).
        if held > live.seq {
            live.seq = held
            state = live
            store.saveSession(live)
        }
        if row.status == "done" || row.deleted {
            markDead(row.deleted ? "session was deleted" : "session was closed on the server")
            return
        }
        notify()
    }

    // MARK: - Unauthorized

    private func handleUnauthorized(_ source: CredentialSource?) {
        if source == .deviceLink {
            linkStore.remove()
            RecorderLog.link.error("vitrinka: recorder token rejected (401) — link the device again")
        } else {
            RecorderLog.link.error("vitrinka: recorder token rejected (401)")
        }
        if state != nil { endLocally() }
        notify(.unauthorized(source))
    }

    private func endLocally() {
        disarmTimers()
        persistTask?.cancel()
        persistTask = nil
        state = nil
        closing = false
        buffer = []
        pending = []
        store.saveSession(nil)
        store.saveBuffer([])
        store.savePending([])
        store.sweepShots()
        rules.set(.defaults)
    }

    /// Forget the device link; a live session ends locally.
    package func unlink() {
        linkStore.remove()
        if state != nil { endLocally() }
        notify(.unauthorized(.deviceLink))
    }

    // MARK: - Stop

    package func stop() async throws -> StopOutcome {
        guard let s = state else { throw RecorderEngineError.notRecording }
        reconcileTask?.cancel()
        reconcileTask = nil
        if s.dead { try completeDeadStop(s.deadReason) }
        if !(await drain()) {
            if let held = state, held.dead { try completeDeadStop(held.deadReason) }
            guard var held = state else { throw RecorderEngineError.unauthorized }
            if !held.paused {
                held.activeMs = held.elapsedMs()
                held.paused = true
                held.resumeAt = nil
                state = held
                store.saveSession(held)
            }
            armReconcile()
            notify()
            throw RecorderEngineError.offline(queued: queuedCount)
        }
        closing = true
        var row: SessionRow?
        do {
            row = SessionRow(json: try await api.json("PATCH", "/api/v1/sessions/\(s.sessionId)", body: ["status": "done"]))
        } catch let e as VitrinkaAPIError {
            if e.isUnauthorized {
                handleUnauthorized(e.credentialSource)
                throw RecorderEngineError.unauthorized
            }
            if !e.isPermanent {
                closing = false
                armReconcile()
                throw e
            }
            // Deleted or revoked: retrying can never succeed; finish locally.
            RecorderLog.engine.error("vitrinka: stop rejected permanently — clearing local session")
        }
        endLocally()
        notify()
        guard let row else { return StopOutcome(sessionID: s.sessionId, boardURL: nil, projectionState: nil) }
        return await waitForBoard(sessionID: s.sessionId, first: row)
    }

    private func completeDeadStop(_ reason: String?) throws -> Never {
        let kept = queuedCount
        endLocally()
        notify()
        throw RecorderEngineError.sessionDead(reason: reason ?? "session rejected by the server", discarded: kept)
    }

    /// The board is built after `done`: poll the session row until its
    /// projection is ready (bounded), then take its `boardUrl`.
    private func waitForBoard(sessionID: String, first: SessionRow) async -> StopOutcome {
        var row = first
        let end = Date().addingTimeInterval(config.boardPollDeadline)
        while true {
            if row.projectionState == "ready" || (row.projectionState == nil && row.boardURL != nil) {
                return StopOutcome(sessionID: sessionID, boardURL: row.boardURL, projectionState: row.projectionState)
            }
            if row.projectionState == "failed" || Date() >= end {
                return StopOutcome(sessionID: sessionID, boardURL: nil, projectionState: row.projectionState)
            }
            try? await Task.sleep(nanoseconds: UInt64(config.boardPollInterval * 1_000_000_000))
            do {
                row = SessionRow(json: try await api.json("GET", "/api/v1/sessions/\(sessionID)"))
            } catch {
                // Keep polling until the deadline; the session is done either way.
            }
        }
    }

    // MARK: - Tests

    package var bufferedEvents: [RecorderEvent] { buffer }
    package var pendingShots: [PendingShot] { pending }
}
#endif
