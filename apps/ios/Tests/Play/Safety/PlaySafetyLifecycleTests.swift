import XCTest

@testable import Sotto

@MainActor
final class PlaySafetyLifecycleTests: XCTestCase {
    func testBlockingClearsGameAndInvitationCachesButKeepsFrozenReportContextBothRecoveriesAndDrafts() async throws {
        let scenario = PlayHTTPScenario()
        let room = try PlayTestFixtures.load().room()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(room)])
        scenario.handle("POST /api/v1/play/rooms/fixture-room/block") { playSafetyCompleted($0) }
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .room(room.id))
        defer { harness.stop() }
        try await waitForPlay("The current member's room is visible") { harness.coordinator.room == room }
        let connection = try XCTUnwrap(harness.model.credentials)
        let ordinary = PlayPendingOperation(id: UUID(), connection: connection, path: "/api/v1/play/rooms/fixture-room/actions",
            body: Data("{}".utf8), response: .room, baseline: room, reconciliationUsed: false)
        try harness.coordinator.save { $0.pending = ordinary; $0.drafts["private-turn"] = "Keep my turn" }
        harness.coordinator.reportRoom = room
        harness.coordinator.rooms = [room]
        harness.coordinator.olderRooms = [room]
        harness.coordinator.openedOlderRooms = true
        harness.coordinator.roomsCursor = "old-page"
        harness.coordinator.invitation = PlayInvitationView(roomId: room.id, code: "ABCDEFGHJK23", generation: 1,
            expiresAt: "2099-01-01T00:00:00Z")
        try await harness.coordinator.blockPartner(in: room)
        XCTAssertEqual(harness.coordinator.screen, .safety)
        XCTAssertNil(harness.coordinator.room)
        XCTAssertTrue(harness.coordinator.rooms.isEmpty)
        XCTAssertTrue(harness.coordinator.olderRooms.isEmpty)
        XCTAssertNil(harness.coordinator.roomsCursor)
        XCTAssertNil(harness.coordinator.invitation)
        XCTAssertTrue(harness.coordinator.requests.isEmpty)
        XCTAssertFalse(harness.coordinator.leaseReady)
        XCTAssertEqual(harness.coordinator.reportRoom, room)
        XCTAssertEqual(try harness.vault.load().pending, ordinary)
        XCTAssertEqual(try harness.vault.load().drafts["private-turn"], "Keep my turn")
        XCTAssertEqual(harness.model.credentials, connection)
        scenario.handle("POST /api/v1/play/rooms/fixture-room/reports") { playSafetyCompleted($0) }
        try await harness.coordinator.sendReport(option: XCTUnwrap(room.reportOptions.first), category: .harassment, detail: "After blocking")
        XCTAssertNil(try harness.vault.load().pendingSafety)
        XCTAssertEqual(try harness.vault.load().pending, ordinary)
    }

    func testEveryKnownSafetyRefusalKeepsAuthenticationAndDraftsWithoutRevisionReconciliation() async throws {
        let fixture = try PlaySafetyFixtures.load()
        for failure in fixture.errors {
            let room = try PlayTestFixtures.load().room()
            let scenario = PlayHTTPScenario()
            scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(room)])
            scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try refusal(failure)])
            let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .room(room.id))
            defer { harness.stop() }
            try await waitForPlay("The original room is displayed") { harness.coordinator.room == room }
            try harness.coordinator.save { $0.drafts["turn"] = "Keep my draft" }
            let before = harness.model.credentials
            let roomReads = harness.server.requests.filter { $0.hasPrefix("GET /api/v1/play/rooms/fixture-room ") }.count
            do { try await harness.coordinator.command(.choose(.A), in: room); XCTFail("Expected typed safety refusal") }
            catch {
                let received = try XCTUnwrap(error as? PlaySafetyFailure)
                XCTAssertEqual(received.reason, failure.body.reason)
                XCTAssertEqual(received.error, failure.body.error)
            }
            XCTAssertFalse(harness.coordinator.accessRevoked)
            XCTAssertEqual(harness.model.credentials, before)
            XCTAssertEqual(try harness.vault.load().drafts["turn"], "Keep my draft")
            XCTAssertNil(try harness.vault.load().pending)
            XCTAssertEqual(harness.server.requests.filter { $0.hasPrefix("POST ") }.count, 1)
            XCTAssertEqual(harness.server.requests.filter { $0.hasPrefix("GET /api/v1/play/rooms/fixture-room ") }.count, roomReads)
            if failure.body.reason == .unavailable {
                XCTAssertTrue(harness.coordinator.gameUnavailable)
                XCTAssertNil(harness.coordinator.room)
            }
        }
    }

    func testRenamedProfileRestoresTheExactSavedConnectionForEitherPendingSlotBeforeRetrying() async throws {
        for slot in [PlayPendingSlot.game, .safety] {
            let scenario = PlayHTTPScenario()
            let renamed = SottoProfile(id: "host-profile", name: "Renamed learner", avatarUrl: "", isOwner: false,
                role: "USER", courseCount: nil, primaryCourse: nil, isActive: true)
            scenario.set("GET /api/v1/profiles", [try .json(["profiles": [renamed]])])
            let harness = try await PlaySafetyHarness.start(scenario: scenario, profile: "guest-profile")
            defer { harness.stop() }
            let original = PlayTestIdentity.connection(server: harness.server.url)
            let action = PlayConductRequest(actionId: UUID(), version: 1)
            let room = try PlayTestFixtures.load().room()
            let pending = PlayPendingOperation(id: UUID(), connection: original,
                path: slot == .safety ? "/api/v1/play/safety/conduct" : "/api/v1/play/rooms/fixture-room/actions",
                body: slot == .safety ? try JSONEncoder().encode(action) : try JSONEncoder().encode(
                    PlayActionRequest(actionId: action.actionId, expectedRevision: room.revision, type: nil, command: .choose(.A))),
                response: slot == .safety ? .safety : .room,
                baseline: nil, reconciliationUsed: false)
            try harness.coordinator.save { $0[keyPath: slot.path] = pending }
            scenario.set("POST \(pending.path)", [slot == .safety
                ? try .json(PlaySafetyCompleted(actionId: action.actionId, completed: true)) : try .json(room)])
            try await harness.coordinator.switchConnection(original)
            XCTAssertEqual(harness.model.credentials, original)
            XCTAssertEqual(try harness.vault.load()[keyPath: slot.path], pending)
            let polling = Task { await harness.coordinator.foreground() }
            defer { polling.cancel(); harness.coordinator.endForeground() }
            try await waitForPlay("The original pending credential is active") {
                harness.coordinator.active && harness.coordinator.boundConnection == original
            }
            try await harness.coordinator.retryAction(slot: slot)
            XCTAssertNil(try harness.vault.load()[keyPath: slot.path])
            let request = try XCTUnwrap(harness.server.requests.first { $0.hasPrefix("POST \(pending.path) ") })
            XCTAssertEqual(try playRequestBody(request), pending.body)
            XCTAssertEqual(playRequestHeader("Authorization", in: request), "Bearer \(original.apiKey)")
        }
    }

    func testAnotherProfilesDelayedSafetyStatusCannotRestorePrivateStateAfterConnectionReplacement() async throws {
        let scenario = PlayHTTPScenario()
        let harness = try await PlaySafetyHarness.start(scenario: scenario)
        defer { harness.stop() }
        let original = try XCTUnwrap(harness.model.credentials)
        let delayed = try PlaySafetyFixtures.load().status(profile: original.selectedProfile!.id, restricted: true)
        scenario.set("GET /api/v1/play/safety", [try .json(delayed, delay: 0.3)])
        let previousReads = harness.server.requests.filter { $0.hasPrefix("GET /api/v1/play/safety ") }.count
        let oldResponse = Task { try await harness.coordinator.loadSafetyStatus(generation: harness.coordinator.epoch, connection: original) }
        try await waitForPlay("The previous profile's status crossed the HTTP boundary") {
            harness.server.requests.filter { $0.hasPrefix("GET /api/v1/play/safety ") }.count > previousReads
        }
        let next = PlayTestIdentity.connection(server: harness.server.url, id: "guest-profile")
        try harness.model.activatePlayConnection(next, profiles: [try XCTUnwrap(next.selectedProfile)])
        harness.coordinator.observeConnection()
        do { try await oldResponse.value; XCTFail("The stale response must be fenced") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertNil(harness.coordinator.safetyStatus)
        XCTAssertTrue(harness.coordinator.blocks.isEmpty)
        XCTAssertTrue(harness.coordinator.safetyReports.isEmpty)
        XCTAssertNil(harness.coordinator.reportRoom)
        XCTAssertEqual(harness.model.credentials, next)
    }

    func testSafetySendWaitsForCancelledTurnCleanupAndPreservesTheOriginalPendingTurnAndDraft() async throws {
        let room = try PlayTestFixtures.load().room()
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(room)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try .json(room, delay: 1)])
        scenario.handle("POST /api/v1/play/safety/conduct") { playSafetyCompleted($0) }
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .room(room.id))
        defer { harness.stop() }
        try await waitForPlay("The turn is ready") { harness.coordinator.room == room }
        try harness.coordinator.save { $0.drafts["private-turn"] = "Unsent private draft" }
        var cleanup: CheckedContinuation<Void, Never>?
        defer { cleanup?.resume() }
        harness.coordinator.run {
            do { try await harness.coordinator.command(.choose(.A), in: room) }
            catch {
                await withCheckedContinuation { cleanup = $0 }
                throw error
            }
        }
        try await waitForPlay("The exact game command was sent") {
            harness.server.requests.contains { $0.hasPrefix("POST /api/v1/play/rooms/fixture-room/actions ") }
        }
        let original = try XCTUnwrap(harness.vault.load().pending)
        harness.coordinator.runSafety { try await harness.coordinator.acceptConduct() }
        try await waitForPlay("Cancellation reached the original turn's cleanup boundary") { cleanup != nil }
        XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST /api/v1/play/safety/conduct ") })
        XCTAssertEqual(try harness.vault.load().pending, original)
        cleanup?.resume()
        cleanup = nil
        try await waitForPlay("Safety completes after ordinary cleanup") {
            !harness.coordinator.safetyBusy && harness.coordinator.notice == "Safety action saved."
        }
        XCTAssertEqual(try harness.vault.load().pending, original)
        XCTAssertEqual(try harness.vault.load().drafts["private-turn"], "Unsent private draft")
        XCTAssertNil(try harness.vault.load().pendingSafety)
    }

    private func refusal(_ failure: PlaySafetyFixtures.Failure) throws -> LocalHTTPServer.Response {
        struct Payload: Encodable { let error: String; let reason: String }
        let encoded = try JSONEncoder().encode(Payload(error: failure.body.error, reason: failure.body.reason.rawValue))
        return .init(status: failure.status, headers: [:], body: String(decoding: encoded, as: UTF8.self))
    }
}
