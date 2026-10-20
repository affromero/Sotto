import XCTest

@testable import Sotto

@MainActor
final class PlayActionRecoveryTests: XCTestCase {
    func testExplicitlyDiscardingAnUnrecoverableActionKeepsItsDraftAndCredentialAndRefusesStaleConfirmation() async throws {
        let server = try LocalHTTPServer { _ in .denied() }
        try await server.start()
        defer { server.stop() }
        let original = PlayTestIdentity.connection(server: server.url)
        let current = PlayTestIdentity.connection(server: server.url, id: "guest-profile")
        let vault = PlayMemoryStore()
        var saved = PlayProtectedState()
        let pending = PlayPendingOperation(id: UUID(), connection: original, path: "/api/v1/play/rooms/fixture-room/actions",
            body: Data("{}".utf8), response: .room, baseline: nil, reconciliationUsed: false)
        saved.pending = pending
        saved.drafts["original-round"] = "My unsubmitted sentence"
        try vault.save(saved)
        let credentials = PlayCredentialMemoryStore()
        let model = SottoAppModel(credentials: current, session: URLSession(configuration: .ephemeral),
            credentialStore: credentials, playStore: vault)
        let coordinator = model.play
        XCTAssertThrowsError(try coordinator.discardPendingAction(id: UUID()))
        XCTAssertEqual(try vault.load(), saved)
        vault.failSave = true
        XCTAssertThrowsError(try coordinator.discardPendingAction(id: pending.id))
        XCTAssertEqual(try vault.load(), saved)
        vault.failSave = false
        try coordinator.discardPendingAction(id: pending.id)
        let recovered = try vault.load()
        XCTAssertNil(recovered.pending)
        XCTAssertEqual(recovered.drafts, saved.drafts)
        XCTAssertTrue(recovered.archivedConnections.contains(original))
        XCTAssertEqual(model.credentials, current)
        XCTAssertNil(credentials.saved)
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testOldNextRoundButtonCannotAdvanceADifferentFinishedRound() async throws {
        let fixtures = try PlayTestFixtures.load()
        let before = try fixtures.room(round: "finished-0-HOST", revision: 10)
        let next = try fixtures.room(round: "finished-1-HOST", revision: 20)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), try .json(next)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.room(before.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The finished round is visible") { coordinator.room != nil }
        try await coordinator.refresh(coordinator.epoch)
        do { try await coordinator.roomAction(.nextRound, in: before); XCTFail("A stale Next button must refuse.") }
        catch { XCTAssertTrue(error.localizedDescription.contains("game changed")) }
        XCTAssertFalse(server.requests.contains { $0.hasPrefix("POST ") })
        XCTAssertEqual(coordinator.room?.round?.id, next.round?.id)
    }

    func testUncertainPickReplaysExactSavedBytesAfterCoordinatorRelaunch() async throws {
        let fixtures = try PlayTestFixtures.load()
        let before = try fixtures.room()
        let after = try fixtures.room(round: "one-pick-0-HOST", revision: 5)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [.denied(503), try .json(after)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        let session = URLSession(configuration: .ephemeral)
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url), session: session,
            credentialStore: PlayCredentialMemoryStore(), playStore: vault)
        let first = model.play
        first.navigate(.room(before.id))
        let polling = Task { await first.foreground() }
        defer { polling.cancel(); first.endForeground() }
        try await waitForPlay("The initial round is visible") { first.room != nil }
        do { try await first.command(.choose(.A), in: before); XCTFail("The first response must be uncertain.") }
        catch { guard case SottoAPIError.http(503, _) = error else { return XCTFail("Expected 503, got \(error)") } }
        let saved = try XCTUnwrap(vault.load().pending)
        first.endForeground()
        let restored = PlayCoordinator(model: model, session: session, store: vault)
        restored.navigate(.room(before.id))
        let restoredPolling = Task { await restored.foreground() }
        defer { restoredPolling.cancel(); restored.endForeground() }
        try await waitForPlay("The restored game is visible") { restored.room != nil }
        try await restored.retryAction()
        XCTAssertNil(try vault.load().pending)
        XCTAssertEqual(restored.room?.round, after.round)
        let posts = server.requests.filter { $0.hasPrefix("POST /api/v1/play/rooms/fixture-room/actions ") }
        XCTAssertEqual(posts.count, 2)
        let bodies = posts.compactMap { $0.components(separatedBy: "\r\n\r\n").last?.data(using: .utf8) }
        XCTAssertTrue(bodies.allSatisfy { $0 == saved.body })
    }

    func testDefiniteIndependentPickConflictUsesOneFreshRevisionAndNewActionID() async throws {
        let fixtures = try PlayTestFixtures.load()
        let before = try fixtures.room("playing-GUEST")
        let concurrent = try fixtures.room("playing-GUEST", round: "one-pick-0-GUEST", revision: 5)
        let finished = try fixtures.room("playing-GUEST", round: "finished-0-GUEST", revision: 6)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), try .json(concurrent)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [.denied(409), try .json(finished)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url, id: "guest-profile"),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.room(before.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The guest round is visible") { coordinator.room != nil }
        try await coordinator.command(.choose(.A), in: before)
        XCTAssertEqual(coordinator.room?.round, finished.round)
        XCTAssertNil(coordinator.state?.pending)
        let requests = try server.requests.filter { $0.hasPrefix("POST ") }.map {
            try JSONDecoder().decode(PlayActionRequest.self, from: Data(XCTUnwrap($0.components(separatedBy: "\r\n\r\n").last).utf8))
        }
        XCTAssertEqual(requests.map(\.expectedRevision), [4, 5])
        XCTAssertNotEqual(requests.first?.actionId, requests.last?.actionId)
    }

    func testDisplayedDraftCannotBeSubmittedToADifferentRound() async throws {
        let fixtures = try PlayTestFixtures.load()
        let before = try fixtures.room()
        let next = try fixtures.room(round: "initial-1-HOST", revision: 8)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), try .json(next)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.room(before.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The original round is visible") { coordinator.room != nil }
        try await coordinator.refresh(coordinator.epoch)
        do { try await coordinator.command(.choose(.A), in: before); XCTFail("A stale turn must refuse the command.") }
        catch { XCTAssertTrue(error.localizedDescription.contains("turn changed")) }
        XCTAssertFalse(server.requests.contains { $0.hasPrefix("POST ") })
        XCTAssertEqual(coordinator.room?.round?.id, next.round?.id)
        XCTAssertNil(coordinator.state?.pending)
    }

    func testRevocationFencesADelayedSuccessfulActionAndKeepsItsExactRecovery() async throws {
        let fixtures = try PlayTestFixtures.load()
        let before = try fixtures.room()
        let after = try fixtures.room(round: "one-pick-0-HOST", revision: 5)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), .denied()])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try .json(after, delay: 0.3)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.room(before.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The round is visible") { coordinator.room != nil }
        let action = Task { try await coordinator.command(.choose(.A), in: before) }
        try await waitForPlay("The action crossed the HTTP boundary") { server.requests.contains { $0.hasPrefix("POST ") } }
        do { try await coordinator.refresh(coordinator.epoch); XCTFail("Access must be refused.") }
        catch { }
        do { try await action.value; XCTFail("The old completion must be fenced.") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertTrue(coordinator.accessRevoked)
        XCTAssertNil(coordinator.room)
        XCTAssertNotNil(coordinator.state?.pending)
    }
}
