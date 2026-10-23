#if DEBUG
import AppKit
import Network
import VitrinkaRecorderCore

/// The live recorder: wires the Core engine to AppKit (event lanes, window
/// lanes, keyframes, the console lane, the HUD, annotate).
@MainActor
final class RecorderRuntime {
    private(set) static var shared: RecorderRuntime?

    static func configure(_ configuration: VitrinkaRecorderConfiguration) {
        guard shared == nil else {
            RecorderLog.engine.error("vitrinka: configure called twice — the first configuration stays")
            return
        }
        let rt = RecorderRuntime(configuration)
        shared = rt
        rt.boot()
    }

    enum ShotReason: String { case start, nav, click, mark, annotate }

    let config: VitrinkaRecorderConfiguration
    let engine: RecorderEngine
    let linkStore: LinkStore
    let credential: @Sendable () -> ResolvedCredential?
    let appName: String
    /// CFBundleDisplayName, else CFBundleName: the default session title.
    let displayName: String
    /// The app's own unified-log subsystems (the console lane's filter).
    let ownSubsystems: [String]
    let model = HUDModel()

    private var hud: HUDController?
    private var console: ConsoleLane?
    private var monitor: Any?
    private var observers: [NSObjectProtocol] = []
    private var timer: Timer?
    private var pathMonitor: NWPathMonitor?
    private var linkTask: Task<Void, Never>?
    private var overlay: AnnotateOverlay?

    // Session mirror (the engine is the truth; these answer synchronously).
    private var sessionActive = false
    private var paused = false
    private var health: EngineHealth?
    private var lastBoardURL: URL?

    // Event pipe: pushes reach the engine in the order they happened.
    private let pipe: AsyncStream<PipeItem>.Continuation
    private enum PipeItem {
        case event(kind: String, payload: JSONObject, lane: Lane, at: Date)
        case barrier(CheckedContinuation<Void, Never>)
    }

    // Keyframes.
    private var lastShotAt = Date.distantPast
    private var shotInFlight = false
    private var trailingShot: Task<Void, Never>?
    private var captureTasks: [UUID: Task<Void, Never>] = [:]
    private var lastHash: [String: UInt64] = [:]
    private var geometry: [String: CaptureGeometry] = [:]

    // Window lanes.
    private var laneIDs: [Int: String] = [:]
    private var navKeys: [String: String] = [:]
    private var focusedLane: String?

    static let throttle: TimeInterval = 0.7
    static let clickDelay: TimeInterval = 0.12
    static let navDelay: TimeInterval = 0.25
    static let sheetDelay: TimeInterval = 0.45
    static let labelCap = 120

    private init(_ c: VitrinkaRecorderConfiguration) {
        config = c
        let info = Bundle.main.infoDictionary ?? [:]
        let appID = c.appID ?? Bundle.main.bundleIdentifier ?? ProcessInfo.processInfo.processName
        appName = (info["CFBundleName"] as? String) ?? ProcessInfo.processInfo.processName
        displayName = (info["CFBundleDisplayName"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? appName
        ownSubsystems = ConsoleLane.ownSubsystems(bundleID: Bundle.main.bundleIdentifier, appID: appID)
        let dir = Self.storageDirectory(appID: appID)
        let links = LinkStore(directory: dir)
        linkStore = links
        let cred: @Sendable () -> ResolvedCredential?
        switch c.credential {
        case .automatic:
            let ladder = CredentialLadder(environment: ProcessInfo.processInfo.environment,
                                          userDefault: { UserDefaults.standard.string(forKey: "VitrinkaRecorderToken") }, link: links)
            cred = { ladder.resolve() }
        case .deviceLink:
            let ladder = CredentialLadder(environment: [:], userDefault: { nil }, link: links, useEnvironment: false)
            cred = { ladder.resolve() }
        case let .provider(f):
            cred = { f().flatMap { $0.isEmpty ? nil : ResolvedCredential(token: $0, source: .host) } }
        }
        credential = cred
        let v = ProcessInfo.processInfo.operatingSystemVersion
        let engineConfig = EngineConfig(
            appID: appID,
            appVersion: c.appVersion ?? (info["CFBundleShortVersionString"] as? String),
            osVersion: "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)",
            devicePixelRatio: Double(NSScreen.main?.backingScaleFactor ?? 2),
            directory: dir
        )
        let engine = RecorderEngine(config: engineConfig, api: VitrinkaAPI(base: c.baseURL, credential: cred))
        self.engine = engine

        let (stream, continuation) = AsyncStream<PipeItem>.makeStream()
        pipe = continuation
        Task {
            for await item in stream {
                switch item {
                case let .event(kind, payload, lane, at):
                    await engine.push(kind, payload: payload, lane: lane, at: at)
                case let .barrier(done):
                    done.resume()
                }
            }
        }
    }

    static func storageDirectory(appID: String) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? appID, isDirectory: true)
            .appendingPathComponent("VitrinkaRecorder", isDirectory: true)
    }

    // MARK: - Boot

    private func boot() {
        if config.hud == .floating {
            let h = HUDController(model: model)
            hud = h
            wireHUD()
            h.show()
        }
        if config.eventSource == .localMonitor {
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]) { event in
                let swallow = MainActor.assumeIsolated { RecorderRuntime.shared?.handle(event, canSwallow: true) ?? false }
                return swallow ? nil : event
            }
        }
        let nc = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didEndSheetNotification] {
            observers.append(nc.addObserver(forName: name, object: nil, queue: .main) { note in
                let window = note.object as? NSWindow
                MainActor.assumeIsolated {
                    guard let window else { return }
                    RecorderRuntime.shared?.windowChanged(window, sheetBegan: false)
                }
            })
        }
        observers.append(nc.addObserver(forName: NSWindow.willBeginSheetNotification, object: nil, queue: .main) { note in
            let window = note.object as? NSWindow
            MainActor.assumeIsolated {
                guard let window else { return }
                RecorderRuntime.shared?.windowChanged(window, sheetBegan: true)
            }
        })
        observers.append(nc.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { RecorderRuntime.shared?.persistBeforeExit() }
        })
        RouteRegistry.shared.onChange = { [weak self] laneWindow in self?.routeChanged(laneWindow) }

        console = ConsoleLane(filter: config.logs, own: ownSubsystems) { lines in
            await MainActor.run { RecorderRuntime.shared?.pushConsole(lines) }
        }

        let engine = self.engine
        let pm = NWPathMonitor()
        pm.pathUpdateHandler = { path in
            if path.status == .satisfied { Task { await engine.resetBackoff() } }
        }
        pm.start(queue: DispatchQueue(label: "dev.vitrinka.recorder.path"))
        pathMonitor = pm

        Task {
            await engine.setNoticeHandler { notice in
                Task { @MainActor in RecorderRuntime.shared?.handle(notice) }
            }
            if let s = await engine.recover() {
                self.model.message = "Recording \"\(s.title.isEmpty ? s.sessionId : s.title)\" recovered — resume or stop."
            }
            await self.refresh()
        }
        refreshLinked()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in await RecorderRuntime.shared?.refresh() }
        }
    }

    private func wireHUD() {
        model.onStart = { [weak self] in self?.hudTask { try await $0.start(title: nil) } }
        model.onStop = { [weak self] in self?.hudTask { _ = try await $0.stop() } }
        model.onTogglePause = { [weak self] in
            guard let self else { return }
            Task { await self.setPaused(!self.paused) }
        }
        model.onNote = { [weak self] text in self?.note(text) }
        model.onMark = { [weak self] in self?.mark("") }
        model.onAnnotate = { [weak self] in self?.annotate() }
        model.onLink = { [weak self] in self?.link() }
        model.onCancelLink = { [weak self] in self?.cancelLink() }
        model.onUnlink = { [weak self] in
            guard let self else { return }
            Task { await self.unlink() }
        }
        model.onOpenURL = { url in NSWorkspace.shared.open(url) }
        model.onDismissSaved = { [weak self] in
            self?.model.phase = .idle
            self?.model.message = nil
        }
    }

    /// Run a HUD action; its error lands in the HUD message.
    private func hudTask(_ work: @escaping @MainActor (RecorderRuntime) async throws -> Void) {
        Task {
            do {
                try await work(self)
            } catch {
                self.model.message = (error as? VitrinkaRecorderError)?.description ?? String(describing: error)
            }
        }
    }

    // MARK: - State

    var publicState: VitrinkaRecorderState {
        var s = VitrinkaRecorderState()
        s.isConfigured = true
        s.isLinked = model.linked
        s.isRecording = sessionActive
        s.isPaused = paused
        s.sessionID = health?.sessionID
        s.frames = health?.shots ?? 0
        s.queued = health?.queued ?? 0
        s.sync = VitrinkaRecorderState.Sync(rawValue: health?.state.rawValue ?? "idle") ?? .idle
        s.lastBoardURL = lastBoardURL
        return s
    }

    private var recordingLive: Bool { sessionActive && !paused }

    func refresh() async {
        let h = await engine.health()
        health = h
        sessionActive = h.sessionID != nil
        paused = h.paused
        // Publish only real changes: the buttons observe `model` and must not
        // re-render every second (stable views for VoiceOver and automation);
        // the clock and counters live in `model.status`.
        if model.paused != h.paused { model.paused = h.paused }
        if model.recovered != h.recovered { model.recovered = h.recovered }
        let sync: HUDModel.Sync
        switch h.state {
        case .dead: sync = .dead
        case .offline: sync = .offline
        case .backlog: sync = .backlog
        default: sync = .ok
        }
        model.status.update(elapsed: h.elapsedMs / 1000, frames: h.shots, queued: h.queued, sync: sync)
        if sessionActive, model.phase == .idle || model.phase == .saved { model.phase = .recording }
        if !sessionActive, model.phase == .recording { model.phase = .idle }
        if sessionActive { AccessibilityTree.activate() } else { AccessibilityTree.deactivate() }
    }

    private func refreshLinked() {
        let c = credential()
        model.linked = c != nil
        model.linkedByDevice = c?.source == .deviceLink
    }

    private func handle(_ notice: EngineNotice) {
        switch notice {
        case .changed:
            break
        case let .dead(reason):
            model.message = "\(reason). Press Stop to end the recording."
        case let .unauthorized(source):
            sessionActive = false
            AccessibilityTree.deactivate()
            if let c = console { Task { await c.stop() } }
            if source == .deviceLink {
                model.message = "vitrinka rejected this Mac's link. Link it again."
            } else if source != nil {
                model.message = "vitrinka rejected the recorder token (401)."
            }
            if model.phase == .recording || model.phase == .starting { model.phase = .idle }
            refreshLinked()
        }
        Task { await refresh() }
    }

    // MARK: - Lifecycle

    func start(title: String?) async throws {
        if await engine.session != nil { throw VitrinkaRecorderError.alreadyRecording }
        refreshLinked()
        guard credential() != nil else {
            model.message = "Link this Mac to vitrinka first."
            throw VitrinkaRecorderError.notLinked
        }
        model.phase = .starting
        model.message = nil
        let given = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        do {
            _ = try await engine.start(title: given.isEmpty ? defaultTitle() : given, environment: config.environment, driver: "human")
        } catch {
            model.phase = .idle
            let mapped = Self.map(error)
            model.message = mapped.description
            refreshLinked()
            throw mapped
        }
        sessionActive = true
        paused = false
        // Before the first click: SwiftUI builds its accessibility tree now.
        AccessibilityTree.activate()
        resetCaptureState()
        model.phase = .recording
        await console?.start(from: Date(), newSession: true)
        if let laneWindow = Lanes.currentLaneWindow() {
            screenChanged(laneWindow, focus: true, reason: .start, delay: 0)
        }
        await refresh()
    }

    /// The Expo recorder sends an empty title. A native app's sessions read
    /// better with a name: "<display name> · <local date and time>".
    private func defaultTitle() -> String {
        Self.defaultTitle(displayName: displayName, now: Date())
    }

    nonisolated static func defaultTitle(displayName: String, now: Date, locale: Locale = .current, timeZone: TimeZone = .current) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.dateStyle = .medium
        f.timeStyle = .short
        return "\(displayName) · \(f.string(from: now))"
    }

    func setPaused(_ p: Bool) async {
        guard sessionActive, p != paused else { return }
        paused = p
        await engine.setPaused(p)
        if p {
            await console?.stop()
        } else {
            await console?.start(from: Date(), newSession: false)
            model.message = nil
            if let laneWindow = Lanes.currentLaneWindow() {
                navKeys = [:]
                screenChanged(laneWindow, focus: true, reason: .nav, delay: 0)
            }
        }
        await refresh()
    }

    func stop() async throws -> URL? {
        guard await engine.session != nil else { throw VitrinkaRecorderError.notRecording }
        model.phase = .stopping
        model.noteOpen = false
        overlay?.close()
        overlay = nil
        if let c = console {
            let tail = await c.poll()
            let repeats = await c.drainRepeats()
            pushConsole(tail + repeats)
            await c.stop()
        }
        await settleCaptures(deadline: 5)
        await barrier()
        do {
            let outcome = try await engine.stop()
            sessionActive = false
            paused = false
            AccessibilityTree.deactivate()
            lastBoardURL = outcome.boardURL
            model.boardURL = outcome.boardURL
            model.savedSessionID = outcome.sessionID
            model.message = outcome.boardURL == nil ? "The board is still being built (session \(outcome.sessionID))." : nil
            model.phase = .saved
            await refresh()
            return outcome.boardURL
        } catch {
            let mapped = Self.map(error)
            model.message = mapped.description
            await refresh()
            model.phase = sessionActive ? .recording : .idle
            throw mapped
        }
    }

    func unlink() async {
        cancelLink()
        await engine.unlink()
        refreshLinked()
        model.message = "Unlinked."
    }

    private func persistBeforeExit() {
        let engine = self.engine
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            await engine.persistNow()
            done.signal()
        }
        _ = done.wait(timeout: .now() + 1)
    }

    static func map(_ error: Error) -> VitrinkaRecorderError {
        switch error {
        case let e as VitrinkaRecorderError: return e
        case let e as RecorderEngineError:
            switch e {
            case .alreadyRecording: return .alreadyRecording
            case .notRecording: return .notRecording
            case .notLinked: return .notLinked
            case let .offline(queued): return .offline(queued: queued)
            case .sessionDead: return .sessionEnded(reason: e.description)
            case .unauthorized: return .unauthorized
            }
        case let e as VitrinkaAPIError:
            return e.isUnauthorized ? .unauthorized : .server(status: e.status, message: e.message)
        default:
            return .server(status: 0, message: String(describing: error))
        }
    }

    // MARK: - Device link

    private func link() {
        guard linkTask == nil else { return }
        model.message = nil
        let base = config.baseURL
        let label = "\(appName) on macOS"
        let store = linkStore
        linkTask = Task {
            let session = URLSession(configuration: VitrinkaAPI.defaultConfiguration())
            do {
                let start = try await DeviceLink.start(base: base, label: label, session: session)
                self.model.userCode = start.userCode
                self.model.verifyURL = start.verifyURL
                self.model.phase = .linking
                NSWorkspace.shared.open(start.verifyURL)
                let token = try await DeviceLink.poll(base: base, start: start, session: session)
                try store.write(token)
                self.model.message = "Linked to \(token.workspace.isEmpty ? "vitrinka" : token.workspace)."
            } catch is CancellationError {
                // cancelled from the HUD
            } catch {
                self.model.message = "Link failed: \(error)"
            }
            self.model.userCode = nil
            self.model.verifyURL = nil
            if self.model.phase == .linking { self.model.phase = .idle }
            self.linkTask = nil
            self.refreshLinked()
        }
    }

    private func cancelLink() {
        linkTask?.cancel()
        linkTask = nil
        model.userCode = nil
        model.verifyURL = nil
        if model.phase == .linking { model.phase = .idle }
    }

    // MARK: - Events

    private func send(_ kind: String, _ payload: JSONObject, lane: Lane, at date: Date = Date()) {
        pipe.yield(.event(kind: kind, payload: payload, lane: lane, at: date))
    }

    /// Wait until every event sent so far reached the engine.
    private func barrier() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            pipe.yield(.barrier(c))
        }
    }

    func observe(_ event: NSEvent) {
        _ = handle(event, canSwallow: false)
    }

    /// One mouse-down or key-down. Returns true when the event was a
    /// recorder chord that should not reach the app.
    func handle(_ event: NSEvent, canSwallow: Bool) -> Bool {
        switch event.type {
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            click(event)
            return false
        case .keyDown:
            return key(event) && canSwallow
        default:
            return false
        }
    }

    private func click(_ event: NSEvent) {
        guard recordingLive, let window = event.window, Lanes.isRecordable(window) else { return }
        let laneWindow = Lanes.laneWindow(of: window)
        let screenPoint = window.convertPoint(toScreen: event.locationInWindow)
        var label = ElementLabels.label(in: window, screenPoint: screenPoint)
        // A click inside a private view records where, never what it said.
        let point = ScreenGeometry.toCG(screenPoint)
        let parts = [laneWindow] + Lanes.overlays(of: laneWindow)
        if let rects = PrivateRegistry.shared.privateRects(on: parts) {
            if rects.contains(where: { $0.contains(point) }) { label.text = nil }
        } else {
            label.text = nil
        }
        let lane = laneInfo(laneWindow)
        let geo = currentGeometry(laneWindow, lane: lane.tabId)
        let p = geo.pixel(ScreenGeometry.toCG(screenPoint))
        var payload: JSONObject = ["x": .number(p.x.rounded()), "y": .number(p.y.rounded())]
        if let f = label.frame {
            let r = geo.pixelRect(ScreenGeometry.toCG(f))
            payload["rect"] = ["x": .number(r.minX), "y": .number(r.minY), "w": .number(r.width), "h": .number(r.height)]
        }
        let rules = engine.rules.rules
        if let text = label.text {
            payload["text"] = .string(rules.maskAllText ? "" : String(rules.redactText(text).prefix(Self.labelCap)))
        }
        if let sel = label.selector { payload["selector"] = .string(String(rules.redactText(sel).prefix(Self.labelCap))) }
        payload["route"] = .string(lane.tabHost)
        if event.type == .rightMouseDown { payload["button"] = "right" } else if event.type == .otherMouseDown { payload["button"] = "other" }
        send("click", payload, lane: lane)
        requestShot(.click, laneWindow: laneWindow, delay: Self.clickDelay)
    }

    private func key(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags
        if config.chords == .standard, sessionActive, let chord = KeyCombos.chord(keyCode: event.keyCode, flags: flags) {
            return perform(chord)
        }
        guard recordingLive, config.keys == .shortcutsOnly, let window = event.window, Lanes.isRecordable(window) else { return false }
        // A secure field sends nothing, not even Return.
        if let tv = window.firstResponder as? NSTextView, tv.isFieldEditor, tv.delegate is NSSecureTextField { return false }
        if window.firstResponder is NSSecureTextField { return false }
        guard let combo = KeyCombos.combo(keyCode: event.keyCode, flags: flags, charactersIgnoringModifiers: event.charactersIgnoringModifiers) else {
            return false
        }
        let laneWindow = Lanes.laneWindow(of: window)
        let lane = laneInfo(laneWindow)
        var payload: JSONObject = ["combo": .string(combo)]
        let rules = engine.rules.rules
        if let target = ElementLabels.label(of: window.firstResponder)?.text, !rules.maskAllText {
            payload["target"] = .string(String(rules.redactText(target).prefix(Self.labelCap)))
        }
        payload["route"] = .string(lane.tabHost)
        send("key", payload, lane: lane)
        return false
    }

    private func perform(_ chord: KeyCombos.Chord) -> Bool {
        switch chord {
        case .pause:
            Task { await setPaused(!paused) }
        case .stop:
            hudTask { _ = try await $0.stop() }
        case .note:
            guard !paused else { return false }
            if hud != nil { model.openNote() } else { return false }
        case .annotate:
            guard !paused else { return false }
            annotate()
        }
        return true
    }

    func note(_ text: String) {
        guard recordingLive, let laneWindow = Lanes.currentLaneWindow() else { return }
        let lane = laneInfo(laneWindow)
        send("note", ["text": .string(text), "route": .string(lane.tabHost)], lane: lane)
    }

    /// A forced keyframe, then a note: a plain note binds to the current
    /// screen (the last shot before it), so the frame comes first.
    func mark(_ text: String) {
        guard recordingLive, let laneWindow = Lanes.currentLaneWindow() else { return }
        let id = UUID()
        captureTasks[id] = Task {
            await self.shoot(.mark, laneWindow: laneWindow, force: true)
            let lane = self.laneInfo(laneWindow)
            let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
            self.send("note", ["text": .string(body.isEmpty ? "Marked" : body), "mark": true, "route": .string(lane.tabHost)], lane: lane)
            self.captureTasks[id] = nil
        }
    }

    func setRoute(_ route: String, window: NSWindow?) {
        guard let w = window.map(Lanes.laneWindow(of:)) ?? Lanes.currentLaneWindow() else { return }
        RouteRegistry.shared.setBase(route, for: w)
        routeChanged(w)
    }

    private func pushConsole(_ lines: [ConsoleLine]) {
        guard recordingLive, !lines.isEmpty, let laneWindow = Lanes.currentLaneWindow() else { return }
        let lane = laneInfo(laneWindow)
        let rules = engine.rules.rules
        for l in lines {
            var payload: JSONObject = [
                "level": .string(l.level),
                "osLevel": .string(l.osLevel),
                "text": .string(String(rules.redactText(l.text).prefix(ConsoleLane.textCap))),
                "subsystem": .string(l.subsystem),
                "category": .string(l.category),
            ]
            if let n = l.repeats { payload["repeats"] = .number(Double(n)) }
            if l.capped { payload["capped"] = true }
            send("console", payload, lane: lane, at: l.date)
        }
    }

    // MARK: - Window lanes

    private func laneID(_ laneWindow: NSWindow) -> String {
        if let id = laneIDs[laneWindow.windowNumber] { return id }
        var id = Lanes.laneID(for: laneWindow)
        let taken = Set(laneIDs.values)
        if taken.contains(id) {
            var n = 2
            while taken.contains("\(id)-\(n)") { n += 1 }
            id = "\(id)-\(n)"
        }
        laneIDs[laneWindow.windowNumber] = id
        return id
    }

    func laneInfo(_ laneWindow: NSWindow) -> Lane {
        let id = laneID(laneWindow)
        var path = Lanes.path(lane: id, route: RouteRegistry.shared.route(for: laneWindow))
        if let sanitize = config.sanitizeRoute { path = sanitize(path) }
        return Lane(tabId: id, tabHost: engine.rules.rules.redactUrl(path))
    }

    private func title(of window: NSWindow) -> String {
        String(engine.rules.rules.redactText(window.title).prefix(Self.labelCap))
    }

    private func windowChanged(_ window: NSWindow, sheetBegan: Bool) {
        guard recordingLive, Lanes.isRecordable(window) else { return }
        if sheetBegan {
            // Let the sheet attach and its content (route markers) arrive.
            Task {
                try? await Task.sleep(nanoseconds: 200_000_000)
                self.windowChanged(window, sheetBegan: false)
            }
            return
        }
        let laneWindow = Lanes.laneWindow(of: window)
        let focus = NSApp.keyWindow.map { Lanes.laneWindow(of: $0) === laneWindow } ?? true
        screenChanged(laneWindow, focus: focus, reason: .nav, delay: laneWindow.attachedSheet != nil ? Self.sheetDelay : Self.navDelay)
    }

    private func routeChanged(_ laneWindow: NSWindow) {
        guard recordingLive, Lanes.isRecordable(laneWindow) else { return }
        screenChanged(laneWindow, focus: false, reason: .nav, delay: Self.navDelay)
    }

    /// A lane's screen changed (focus, a sheet, a route): one `nav` event and
    /// a keyframe, unless nothing changed.
    private func screenChanged(_ laneWindow: NSWindow, focus: Bool, reason: ShotReason, delay: TimeInterval) {
        let lane = laneInfo(laneWindow)
        let sheet = laneWindow.attachedSheet
        let key = "\(sheet?.windowNumber ?? 0)|\(lane.tabHost)"
        let focusMoved = focus && focusedLane != lane.tabId
        guard focusMoved || navKeys[lane.tabId] != key else { return }
        if focus { focusedLane = lane.tabId }
        navKeys[lane.tabId] = key
        var payload: JSONObject = ["route": .string(lane.tabHost), "title": .string(title(of: laneWindow))]
        if let sheet { payload["sheet"] = .string(sheet.title.isEmpty ? "sheet" : title(of: sheet)) }
        send("nav", payload, lane: lane)
        requestShot(reason, laneWindow: laneWindow, delay: delay, force: reason == .start)
    }

    // MARK: - Keyframes

    private func resetCaptureState() {
        lastShotAt = .distantPast
        shotInFlight = false
        trailingShot?.cancel()
        trailingShot = nil
        lastHash = [:]
        navKeys = [:]
        focusedLane = nil
    }

    private func currentGeometry(_ laneWindow: NSWindow, lane: String) -> CaptureGeometry {
        if let g = geometry[lane] { return g }
        let frame = ScreenGeometry.toCG(laneWindow.frame)
        var scale = Double(laneWindow.backingScaleFactor)
        if engine.rules.rules.pixelPolicy == .blur { scale = Double(WindowCapture.blurWidth) / max(1, frame.width) }
        return CaptureGeometry(originCG: frame.origin, sizePoints: frame.size, scale: scale)
    }

    /// Throttled like the Expo recorder (700 ms, one in flight), with one
    /// trailing shot so the screen a burst settles on is still captured.
    private func requestShot(_ reason: ShotReason, laneWindow: NSWindow, delay: TimeInterval, force: Bool = false) {
        guard recordingLive else { return }
        let now = Date()
        if !force, now.timeIntervalSince(lastShotAt) < Self.throttle || shotInFlight {
            if trailingShot == nil {
                let wait = max(delay, Self.throttle - now.timeIntervalSince(lastShotAt)) + 0.05
                trailingShot = Task {
                    try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
                    self.trailingShot = nil
                    if !Task.isCancelled { self.requestShot(reason, laneWindow: laneWindow, delay: 0) }
                }
            }
            return
        }
        lastShotAt = now
        if !force { shotInFlight = true }
        let id = UUID()
        captureTasks[id] = Task {
            if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)) }
            await self.shoot(reason, laneWindow: laneWindow, force: force)
            if !force { self.shotInFlight = false }
            self.captureTasks[id] = nil
        }
    }

    /// Capture the lane window and queue the frame. An unchanged screen is
    /// skipped, except for forced frames (start, marks, annotations).
    private func shoot(_ reason: ShotReason, laneWindow: NSWindow, force: Bool) async {
        guard recordingLive, Lanes.isRecordable(laneWindow), laneWindow.isVisible,
              !PrivateRegistry.shared.containsWindow(laneWindow) else { return }
        let frame: CapturedFrame
        do {
            frame = try await WindowCapture.capture(laneWindow: laneWindow, blur: engine.rules.rules.pixelPolicy == .blur)
        } catch CaptureFailure.privateViewUnresolved {
            RecorderLog.capture.error("vitrinka: a private view could not be located — frame dropped")
            return
        } catch {
            RecorderLog.capture.error("vitrinka: capture failed: \(String(describing: error), privacy: .public)")
            return
        }
        guard recordingLive || reason == .mark else { return }
        let lane = laneInfo(laneWindow)
        geometry[lane.tabId] = frame.geometry
        if !force, lastHash[lane.tabId] == frame.thumbHash { return }
        lastHash[lane.tabId] = frame.thumbHash
        await engine.enqueueShot(frame.jpeg, lane: lane, payload: shotPayload(frame, lane: lane, laneWindow: laneWindow, reason: reason), at: frame.capturedAt)
    }

    private func shotPayload(_ frame: CapturedFrame, lane: Lane, laneWindow: NSWindow, reason: ShotReason) -> JSONObject {
        var p: JSONObject = [
            "route": .string(lane.tabHost),
            "title": .string(title(of: laneWindow)),
            "reason": .string(reason.rawValue),
            "w": .number(Double(frame.pixelWidth)),
            "h": .number(Double(frame.pixelHeight)),
            "scale": .number(frame.geometry.scale),
        ]
        if frame.fidelity != "window" { p["fidelity"] = .string(frame.fidelity) }
        return p
    }

    /// Stop waits for in-flight captures (bounded), so the frame of the last
    /// click makes the session.
    private func settleCaptures(deadline: TimeInterval) async {
        trailingShot?.cancel()
        trailingShot = nil
        let end = Date().addingTimeInterval(deadline)
        while !captureTasks.isEmpty, Date() < end {
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        if !captureTasks.isEmpty {
            RecorderLog.capture.error("vitrinka: \(self.captureTasks.count) capture(s) still running at stop — left behind")
            captureTasks.values.forEach { $0.cancel() }
            captureTasks = [:]
        }
    }

    // MARK: - Annotate

    func annotate() {
        guard recordingLive, overlay == nil, let laneWindow = Lanes.currentLaneWindow(),
              !PrivateRegistry.shared.containsWindow(laneWindow) else { return }
        let id = UUID()
        captureTasks[id] = Task {
            defer { self.captureTasks[id] = nil }
            // The held frame: taken before the overlay exists.
            guard let frame = try? await WindowCapture.capture(laneWindow: laneWindow, blur: self.engine.rules.rules.pixelPolicy == .blur),
                  let seq = await self.engine.reserveSeq()
            else {
                self.model.message = "Could not take the frame to annotate."
                return
            }
            let lane = self.laneInfo(laneWindow)
            let payload = self.shotPayload(frame, lane: lane, laneWindow: laneWindow, reason: .annotate)
            let overlay = AnnotateOverlay(over: laneWindow.frame, level: laneWindow.level, done: { [weak self] text, screenRect in
                guard let self else { return }
                self.overlay = nil
                let px = frame.geometry.pixelRect(ScreenGeometry.toCG(screenRect))
                let noteAt = Date()
                let note: JSONObject = [
                    "text": .string(text),
                    "rect": ["x": .number(px.minX), "y": .number(px.minY), "w": .number(px.width), "h": .number(px.height)],
                    "annotate": true,
                    "route": .string(lane.tabHost),
                ]
                Task {
                    await self.barrier()
                    // The note first, then the held frame at note ts + 1 ms:
                    // the projection binds an annotate note to the NEXT shot.
                    if await self.engine.push("note", payload: note, lane: lane, at: noteAt) != nil {
                        await self.engine.enqueueShot(frame.jpeg, lane: lane, payload: payload, at: noteAt.addingTimeInterval(0.001), reservedSeq: seq)
                        self.lastHash[lane.tabId] = frame.thumbHash
                    }
                }
            }, cancel: { [weak self] in
                self?.overlay = nil
            })
            self.overlay = overlay
            overlay.present()
        }
    }
}
#endif
