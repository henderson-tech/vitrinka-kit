import Foundation
@testable import VitrinkaRecorderCore
import XCTest

final class RecorderEngineTests: XCTestCase {
    var server: MockServer!
    var dir: URL!

    override func setUp() {
        server = MockServer()
        MockServer.current = server
        dir = TestSupport.tempDir()
    }

    override func tearDown() {
        MockServer.current = nil
        try? FileManager.default.removeItem(at: dir)
    }

    private func eventsBatches() -> [[JSONValue]] {
        server.requests("POST", "/api/v1/sessions/42/events").compactMap { $0.json?["events"]?.arrayValue }
    }

    // MARK: session create

    func testSessionCreateSendsAppTitleAndMacMeta() async throws {
        let engine = TestSupport.engine(dir: dir)
        let s = try await engine.start(title: "Checkout flow")
        XCTAssertEqual(s.sessionId, "42" as String, "the server's numeric id is kept as a string")
        XCTAssertEqual(s.project, "recorder-e2e")

        let create = try XCTUnwrap(server.requests("POST", "/api/v1/sessions").first { $0.path == "/api/v1/sessions" })
        let body = try XCTUnwrap(create.json)
        XCTAssertEqual(body["app"], "dev.vitrinka.recorder-demo")
        XCTAssertEqual(body["title"], "Checkout flow")
        XCTAssertNil(body["environment"], "no explicit lane: the app-id rule decides")
        let meta = try XCTUnwrap(body["meta"])
        XCTAssertEqual(meta["recorder"], .string("macos/\(RecorderIdentity.version)"))
        XCTAssertEqual(meta["platform"], "macos")
        XCTAssertEqual(meta["appVersion"], "1.2.3")
        XCTAssertEqual(meta["osVersion"], "26.3.0")
        XCTAssertEqual(meta["devicePixelRatio"], 2)
        XCTAssertEqual(meta["driver"], "human")

        XCTAssertEqual(create.header("Authorization"), "Bearer vkr_test")
        XCTAssertEqual(create.header("Content-Type"), "application/json")
        XCTAssertTrue(create.header("User-Agent")?.contains(RecorderIdentity.canary) == true, "the canary rides in the User-Agent")
        XCTAssertNil(create.header("Origin"), "a native client never sends Origin")
        XCTAssertNil(create.header("Cookie"))
    }

    func testPolicyLandsAfterStartAndIsKeptWithTheSession() async throws {
        server.setRoute { r in
            if r.path == "/api/v1/recorder/policy" {
                return .json(200, ["policy": ["extraBodyKeys": ["internalId"], "maskAllText": true], "attachments": false])
            }
            return MockServer.happy(r)
        }
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await TestSupport.settle()
        XCTAssertTrue(engine.rules.rules.maskAllText)
        XCTAssertEqual(engine.rules.rules.pixelPolicy, .blur)
        let s = await engine.session
        XCTAssertEqual(s?.policySettled, true)
        XCTAssertNotNil(s?.policyJSON)
    }

    // MARK: seq and batching

    func testEventsGoOutAsAnObjectWithStrictlyIncreasingSeqs() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await engine.push("nav", payload: ["route": "/main"], lane: TestSupport.lane)
        await engine.push("click", payload: ["x": 10, "y": 20, "text": "Save"], lane: TestSupport.lane)
        await engine.push("note", payload: ["text": "looks off"], lane: TestSupport.lane)
        let ok = await engine.flush()
        XCTAssertTrue(ok)

        let post = try XCTUnwrap(server.requests("POST", "/api/v1/sessions/42/events").first)
        let body = try XCTUnwrap(post.json)
        XCTAssertNotNil(body.objectValue, "the events body is an object, never a bare array")
        let events = try XCTUnwrap(body["events"]?.arrayValue)
        XCTAssertEqual(events.compactMap { $0["seq"]?.intValue }, [1, 2, 3])
        XCTAssertEqual(events.compactMap { $0["kind"]?.stringValue }, ["nav", "click", "note"])
        for e in events {
            XCTAssertEqual(e["tabId"], "main")
            XCTAssertEqual(e["tabHost"], "/main")
            XCTAssertNotNil(Timestamp.parse(e["ts"]?.stringValue ?? ""))
        }
        let left = await engine.queuedCount
        XCTAssertEqual(left, 0)
    }

    func testBatchesHoldAtMost500Events() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        for i in 0 ..< 1200 {
            await engine.push("click", payload: ["i": .number(Double(i))], lane: TestSupport.lane)
        }
        for _ in 0 ..< 3 { _ = await engine.flush() }
        let sizes = eventsBatches().map(\.count)
        XCTAssertEqual(sizes, [500, 500, 200])
        let seqs = eventsBatches().flatMap { $0.compactMap { $0["seq"]?.intValue } }
        XCTAssertEqual(seqs, Array(1 ... 1200))
    }

    func testBatchesHoldAtMost3MiBAndAnEventOverTheWireCapIsDropped() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        let mib = 1024 * 1024
        func blob(_ bytes: Int) -> JSONObject { ["text": .string(String(repeating: "a", count: bytes))] }
        await engine.push("console", payload: blob(mib + mib / 5), lane: TestSupport.lane) // 1: 1.2 MiB
        await engine.push("console", payload: blob(mib + mib / 5), lane: TestSupport.lane) // 2: 1.2 MiB
        await engine.push("console", payload: blob(mib + mib / 5), lane: TestSupport.lane) // 3: 1.2 MiB
        await engine.push("console", payload: blob(3 * mib + mib / 2), lane: TestSupport.lane) // 4: 3.5 MiB, rides alone
        await engine.push("console", payload: blob(4 * mib + mib / 2), lane: TestSupport.lane) // 5: 4.5 MiB, dropped
        await engine.push("note", payload: ["text": "tail"], lane: TestSupport.lane) // 6
        for _ in 0 ..< 5 { _ = await engine.flush() }
        let batches = eventsBatches().map { $0.compactMap { $0["seq"]?.intValue } }
        XCTAssertEqual(batches, [[1, 2], [3], [4], [6]])
        for r in server.requests("POST", "/api/v1/sessions/42/events") {
            XCTAssertLessThanOrEqual(r.body.count, Batching.wireBodyCap)
        }
    }

    // MARK: shots

    func testShotUploadsFirstWithItsSeqAndContentTypeThenTheEventCarriesTheBlobKey() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await engine.push("nav", payload: ["route": "/main"], lane: TestSupport.lane)
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9])
        let seq = await engine.enqueueShot(jpeg, lane: TestSupport.lane, payload: ["route": "/main", "title": "Main", "reason": "start"])
        XCTAssertEqual(seq, 2)
        await engine.push("click", payload: ["text": "Save"], lane: TestSupport.lane)
        _ = await engine.flush()

        let shot = try XCTUnwrap(server.requests("POST", "/api/v1/sessions/42/shot").first)
        XCTAssertEqual(shot.query, "seq=2")
        XCTAssertEqual(shot.header("Content-Type"), "image/jpeg")
        XCTAssertEqual(shot.body, jpeg)

        let all = server.requests
        let shotIndex = try XCTUnwrap(all.firstIndex { $0.path.hasSuffix("/shot") })
        let eventsIndex = try XCTUnwrap(all.firstIndex { $0.path.hasSuffix("/events") })
        XCTAssertLessThan(shotIndex, eventsIndex, "the image uploads before its event")

        let events = eventsBatches().flatMap { $0 }
        let shotEvent = try XCTUnwrap(events.first { $0["kind"] == "shot" })
        XCTAssertEqual(shotEvent["seq"], 2)
        XCTAssertEqual(shotEvent["blobKey"], "uploads/sessions/42/2.jpg", "blobKey is a top-level event field")
        XCTAssertEqual(shotEvent["payload"]?["title"], "Main")
        XCTAssertEqual(Set(events.compactMap { $0["seq"]?.intValue }), [1, 2, 3])
        let pending = await engine.pendingShots
        XCTAssertTrue(pending.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("pending/2.jpg").path))
    }

    func testAFailedShotUploadIsRetriedWithTheSameSeq() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        var shotCalls = 0
        server.setRoute { r in
            if r.path.hasSuffix("/shot") {
                shotCalls += 1
                if shotCalls == 1 { return .status(503) }
            }
            return MockServer.happy(r)
        }
        let seq = await engine.enqueueShot(Data([1, 2, 3]), lane: TestSupport.lane, payload: ["reason": "click"])
        await engine.push("click", payload: ["text": "Next"], lane: TestSupport.lane)
        _ = await engine.flush()
        var pending = await engine.pendingShots
        XCTAssertEqual(pending.map(\.seq), [seq!], "a transient failure keeps the shot and its seq")
        XCTAssertFalse(eventsBatches().flatMap { $0 }.contains { $0["kind"] == "shot" }, "no shot event without a blobKey")
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("pending/\(seq!).jpg").path))

        _ = await engine.flush()
        let uploads = server.requests("POST", "/api/v1/sessions/42/shot").map(\.query)
        XCTAssertEqual(uploads, ["seq=\(seq!)", "seq=\(seq!)"])
        let shotEvent = eventsBatches().flatMap { $0 }.first { $0["kind"] == "shot" }
        XCTAssertEqual(shotEvent?["seq"]?.intValue, seq)
        pending = await engine.pendingShots
        XCTAssertTrue(pending.isEmpty)
    }

    func testTransientFailuresBackOffExponentiallyWithACap() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        server.setRoute { r in r.path.hasSuffix("/events") ? .status(503) : MockServer.happy(r) }
        await engine.push("click", payload: [:], lane: TestSupport.lane)
        var delays: [Double] = []
        for _ in 0 ..< 10 {
            _ = await engine.flush()
            delays.append(await engine.backoffRemaining)
        }
        XCTAssertEqual(delays[0], 2, accuracy: 0.2)
        XCTAssertEqual(delays[1], 4, accuracy: 0.2)
        XCTAssertEqual(delays[2], 8, accuracy: 0.2)
        XCTAssertEqual(delays[9], 300, accuracy: 0.2, "capped at 300 s")
        let health = await engine.health()
        XCTAssertEqual(health.state, .offline)
        XCTAssertEqual(health.queued, 1)
    }

    // MARK: reconcile

    func testReconcileDeadVerdicts() async throws {
        let cases: [(String, MockAnswer)] = [
            ("404", .status(404)),
            ("done", .json(200, ["status": "done", "maxSeq": 0])),
            ("deleted", .json(200, ["status": "recording", "deletedAt": "2026-10-23T20:00:00Z"])),
            ("403", .status(403)),
        ]
        for (name, answer) in cases {
            let server = MockServer()
            MockServer.current = server
            let engine = TestSupport.engine(dir: TestSupport.tempDir())
            _ = try await engine.start(title: "")
            server.setRoute { r in r.method == "GET" && r.path == "/api/v1/sessions/42" ? answer : MockServer.happy(r) }
            await engine.reconcile()
            let h = await engine.health()
            XCTAssertEqual(h.state, .dead, name)
            XCTAssertNotNil(h.deadReason, name)
            let dropped = await engine.push("click", payload: [:], lane: TestSupport.lane)
            XCTAssertNil(dropped, "a dead session accepts no events (\(name))")
        }
    }

    func testReconcileTransientFailureIsNotDeadAndRaisesLocalSeqToTheServers() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        server.setRoute { r in r.method == "GET" && r.path == "/api/v1/sessions/42" ? .status(500) : MockServer.happy(r) }
        await engine.reconcile()
        var h = await engine.health()
        XCTAssertNotEqual(h.state, .dead)
        XCTAssertEqual(h.failures, 1)

        server.setRoute { r in r.method == "GET" && r.path == "/api/v1/sessions/42" ? .json(200, ["status": "recording", "maxSeq": 9]) : MockServer.happy(r) }
        await engine.reconcile()
        h = await engine.health()
        XCTAssertEqual(h.serverMaxSeq, 9)
        XCTAssertEqual(h.localSeq, 9, "a recovered seq never reuses one the server holds")
        let ts = await engine.push("click", payload: [:], lane: TestSupport.lane)
        XCTAssertNotNil(ts)
        let seq = await engine.bufferedEvents.last?.seq
        XCTAssertEqual(seq, 10)
    }

    // MARK: stop

    func testStopDrainsThenPatchesDoneThenPollsForTheBoard() async throws {
        var gets = 0
        server.setRoute { r in
            if r.method == "GET", r.path == "/api/v1/sessions/42" {
                gets += 1
                if gets < 3 { return .json(200, ["status": "done", "boardSlug": "", "projection": ["state": "queued"]]) }
            }
            return MockServer.happy(r)
        }
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await engine.push("nav", payload: ["route": "/main"], lane: TestSupport.lane)
        await engine.enqueueShot(Data([9, 9]), lane: TestSupport.lane, payload: ["reason": "start"])
        await engine.push("click", payload: ["text": "Save"], lane: TestSupport.lane)

        let outcome = try await engine.stop()
        XCTAssertEqual(outcome.sessionID, "42")
        XCTAssertEqual(outcome.boardURL?.absoluteString, "http://localhost:8097/w/dev/boards/recorder-e2e-session-42")
        XCTAssertEqual(outcome.projectionState, "ready")

        let all = server.requests
        let patch = try XCTUnwrap(all.lastIndex { $0.method == "PATCH" })
        XCTAssertEqual(all[patch].json?["status"], "done")
        let lastEvents = try XCTUnwrap(all.lastIndex { $0.path.hasSuffix("/events") })
        let lastShot = try XCTUnwrap(all.lastIndex { $0.path.hasSuffix("/shot") })
        XCTAssertLessThan(lastEvents, patch, "the queue drains before done")
        XCTAssertLessThan(lastShot, patch)
        XCTAssertGreaterThan(all.lastIndex { $0.method == "GET" && $0.path == "/api/v1/sessions/42" } ?? -1, patch, "the board is polled after done")
        XCTAssertEqual(Set(eventsBatches().flatMap { $0 }.compactMap { $0["seq"]?.intValue }), [1, 2, 3])

        let s = await engine.session
        XCTAssertNil(s)
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("session.json").path))
    }

    func testStopReturnsNoBoardWhenTheProjectionIsNotReadyInTime() async throws {
        server.setRoute { r in
            if r.method == "GET", r.path == "/api/v1/sessions/42" {
                return .json(200, ["status": "done", "boardSlug": "", "projection": ["state": "queued"]])
            }
            return MockServer.happy(r)
        }
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        let outcome = try await engine.stop()
        XCTAssertEqual(outcome.sessionID, "42")
        XCTAssertNil(outcome.boardURL)
        XCTAssertEqual(outcome.projectionState, "queued")
    }

    func testOfflineStopThrowsKeepsTheTailAndPauses() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        server.setRoute { r in r.path == "/api/v1/recorder/policy" ? MockServer.happy(r) : .offline }
        await engine.push("nav", payload: ["route": "/main"], lane: TestSupport.lane)
        await engine.push("note", payload: ["text": "offline"], lane: TestSupport.lane)
        await engine.enqueueShot(Data([7]), lane: TestSupport.lane, payload: ["reason": "click"])

        do {
            _ = try await engine.stop()
            XCTFail("an offline stop must throw")
        } catch let e as RecorderEngineError {
            XCTAssertEqual(e, .offline(queued: 3))
        }
        XCTAssertTrue(server.requests("PATCH", "/api/v1/sessions").isEmpty, "never done without the tail")
        let maybe = await engine.session
        let s = try XCTUnwrap(maybe)
        XCTAssertTrue(s.paused)
        XCTAssertFalse(s.dead)

        let onDisk = RecorderStore(directory: dir)
        XCTAssertEqual(onDisk.loadBuffer().map(\.seq), [1, 2])
        XCTAssertEqual(onDisk.loadPending().map(\.seq), [3])
        XCTAssertEqual(onDisk.loadSession()?.sessionId, "42")

        // Online again: a second stop finishes the job.
        server.setRoute(MockServer.happy)
        let outcome = try await engine.stop()
        XCTAssertNotNil(outcome.boardURL)
        XCTAssertEqual(Set(eventsBatches().flatMap { $0 }.compactMap { $0["seq"]?.intValue }), [1, 2, 3])
    }

    func testStopOnADeadSessionEndsLocally() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await engine.push("click", payload: [:], lane: TestSupport.lane)
        server.setRoute { r in r.path.hasSuffix("/events") ? .status(410) : MockServer.happy(r) }
        _ = await engine.flush()
        do {
            _ = try await engine.stop()
            XCTFail("expected sessionDead")
        } catch let RecorderEngineError.sessionDead(reason, discarded) {
            XCTAssertTrue(reason.contains("410"))
            XCTAssertEqual(discarded, 1)
        }
        let s = await engine.session
        XCTAssertNil(s)
    }

    // MARK: recovery

    func testRecoveryFromSessionJSONKeepsTheTailAndContinuesTheSeq() async throws {
        let first = TestSupport.engine(dir: dir)
        _ = try await first.start(title: "Before the crash")
        await first.push("nav", payload: ["route": "/main"], lane: TestSupport.lane)
        await first.push("click", payload: ["text": "A"], lane: TestSupport.lane)
        await first.enqueueShot(Data([1]), lane: TestSupport.lane, payload: ["reason": "click"])
        await first.push("click", payload: ["text": "B"], lane: TestSupport.lane)
        await first.persistNow()

        // A new process: nothing in memory, the files on disk.
        let second = TestSupport.engine(dir: dir)
        let maybe = await second.recover()
        let recovered = try XCTUnwrap(maybe)
        XCTAssertEqual(recovered.sessionId, "42")
        XCTAssertEqual(recovered.title, "Before the crash")
        XCTAssertTrue(recovered.paused, "a recovered session waits for resume or stop")
        XCTAssertTrue(recovered.recovered)
        XCTAssertEqual(recovered.seq, 4)
        let buffered = await second.bufferedEvents.map(\.seq)
        XCTAssertEqual(buffered, [1, 2, 4])
        let pending = await second.pendingShots.map(\.seq)
        XCTAssertEqual(pending, [3])

        await second.setPaused(false)
        await second.push("note", payload: ["text": "after"], lane: TestSupport.lane)
        _ = await second.flush()
        let sent = eventsBatches().flatMap { $0 }.compactMap { $0["seq"]?.intValue }
        XCTAssertEqual(Set(sent), [1, 2, 3, 4, 5])
        XCTAssertEqual(server.requests("PATCH", "/api/v1/sessions/42").last?.json?["status"], "recording")
    }

    // MARK: credentials

    func testA401ForgetsTheLinkTokenAndEndsTheSessionLocally() async throws {
        let links = LinkStore(directory: dir)
        try links.write(LinkedToken(token: "vkr_linked", workspace: "dev", label: "Demo on macOS", expiresIn: 3600, linkedAt: Date()))
        let ladder = CredentialLadder(environment: [:], userDefault: { nil }, link: links)
        XCTAssertEqual(ladder.resolve()?.source, .deviceLink)
        let engine = TestSupport.engine(dir: dir, credential: { ladder.resolve() })
        let notices = NoticeLog()
        await engine.setNoticeHandler { notices.append($0) }
        _ = try await engine.start(title: "")
        XCTAssertEqual(server.requests.first?.header("Authorization"), "Bearer vkr_linked")

        server.setRoute { r in r.path.hasSuffix("/events") ? .status(401) : MockServer.happy(r) }
        await engine.push("click", payload: [:], lane: TestSupport.lane)
        _ = await engine.flush()

        XCTAssertNil(links.read(), "a 401 forgets the stored link")
        XCTAssertFalse(FileManager.default.fileExists(atPath: links.url.path))
        XCTAssertNil(ladder.resolve())
        let s = await engine.session
        XCTAssertNil(s, "the session ends locally")
        XCTAssertTrue(notices.all.contains(.unauthorized(.deviceLink)))
    }

    func testA401OnAnEnvironmentTokenKeepsTheLinkFile() async throws {
        let links = LinkStore(directory: dir)
        try links.write(LinkedToken(token: "vkr_linked", workspace: "dev", label: "x", expiresIn: 1, linkedAt: Date()))
        let ladder = CredentialLadder(environment: ["VITRINKA_RECORDER_TOKEN": "vkr_env"], userDefault: { "vkr_default" }, link: links)
        XCTAssertEqual(ladder.resolve(), ResolvedCredential(token: "vkr_env", source: .environment))
        let engine = TestSupport.engine(dir: dir, credential: { ladder.resolve() })
        _ = try await engine.start(title: "")
        server.setRoute { r in r.path.hasSuffix("/events") ? .status(401) : MockServer.happy(r) }
        await engine.push("click", payload: [:], lane: TestSupport.lane)
        _ = await engine.flush()
        XCTAssertNotNil(links.read())
    }

    func testCredentialLadderOrderAndLinkFileMode() throws {
        let links = LinkStore(directory: dir)
        var ladder = CredentialLadder(environment: [:], userDefault: { nil }, link: links)
        XCTAssertNil(ladder.resolve())
        try links.write(LinkedToken(token: "vkr_linked", workspace: "dev", label: "x", expiresIn: 1, linkedAt: Date()))
        XCTAssertEqual(ladder.resolve()?.source, .deviceLink)
        let mode = try FileManager.default.attributesOfItem(atPath: links.url.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(mode?.int16Value, 0o600)
        ladder.userDefault = { "vkr_default" }
        XCTAssertEqual(ladder.resolve(), ResolvedCredential(token: "vkr_default", source: .userDefaults))
        ladder.environment = ["VITRINKA_RECORDER_TOKEN": " vkr_env "]
        XCTAssertEqual(ladder.resolve(), ResolvedCredential(token: "vkr_env", source: .environment))
        ladder.useEnvironment = false
        XCTAssertEqual(ladder.resolve()?.source, .deviceLink)
    }

    func testPauseDropsEventsAndPatchesStatus() async throws {
        let engine = TestSupport.engine(dir: dir)
        _ = try await engine.start(title: "")
        await engine.setPaused(true)
        let dropped = await engine.push("click", payload: [:], lane: TestSupport.lane)
        XCTAssertNil(dropped)
        await engine.setPaused(false)
        XCTAssertEqual(server.requests("PATCH", "/api/v1/sessions/42").compactMap { $0.json?["status"]?.stringValue }, ["paused", "recording"])
    }
}

final class NoticeLog: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [EngineNotice] = []
    func append(_ n: EngineNotice) {
        lock.lock()
        items.append(n)
        lock.unlock()
    }

    var all: [EngineNotice] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }
}
