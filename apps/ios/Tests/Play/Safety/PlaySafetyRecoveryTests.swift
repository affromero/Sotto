import XCTest

@testable import Sotto

@MainActor
final class PlaySafetyRecoveryTests: XCTestCase {
    func testUncertainReportReplaysExactBytesAfterRelaunchAlongsideTheOriginalTurnAndDrafts() async throws {
        let path = "POST /api/v1/play/rooms/fixture-room/reports"
        let scenario = PlayHTTPScenario()
        scenario.set(path, [.denied(503)])
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .report)
        defer { harness.stop() }
        let room = try PlayTestFixtures.load().room()
        let coordinator = harness.coordinator
        coordinator.reportRoom = room
        let connection = try XCTUnwrap(harness.model.credentials)
        let ordinary = PlayPendingOperation(id: UUID(), connection: connection,
            path: "/api/v1/play/rooms/fixture-room/actions", body: Data("{\"original\":true}".utf8),
            response: .room, baseline: room, reconciliationUsed: false)
        try coordinator.save { $0.pending = ordinary; $0.drafts["original-turn"] = "An unsent private sentence" }
        let option = try XCTUnwrap(room.reportOptions.first)
        do { try await coordinator.sendReport(option: option, category: .harassment, detail: "Please review this player name.")
            XCTFail("An uncertain report must remain recoverable") }
        catch { guard case SottoAPIError.http(503, _) = error else { throw error } }
        let pending = try XCTUnwrap(harness.vault.load().pendingSafety)
        let submitted = try JSONDecoder().decode(PlayReportRequest.self, from: pending.body)
        XCTAssertEqual(submitted.expectedVisibleText, option.text)
        XCTAssertEqual(submitted.selector, option.selector)
        XCTAssertEqual(submitted.detail, "Please review this player name.")
        XCTAssertEqual(try harness.vault.load().pending, ordinary)
        coordinator.endForeground()
        harness.polling.cancel()
        scenario.set(path, [try .json(PlaySafetyCompleted(actionId: submitted.actionId, completed: true))])
        let restored = PlayCoordinator(model: harness.model, session: harness.coordinator.session, store: harness.vault)
        restored.navigate(.safety)
        let polling = Task { await restored.foreground() }
        defer { polling.cancel(); restored.endForeground() }
        try await waitForPlay("The original connection is active after relaunch") { restored.active && restored.boundConnection == connection }
        try await restored.retryAction(slot: .safety)
        let saved = try harness.vault.load()
        XCTAssertNil(saved.pendingSafety)
        XCTAssertEqual(saved.pending, ordinary)
        XCTAssertEqual(saved.drafts["original-turn"], "An unsent private sentence")
        XCTAssertEqual(harness.model.credentials, connection)
        let posts = harness.server.requests.filter { $0.hasPrefix("\(path) ") }
        XCTAssertEqual(posts.count, 2)
        XCTAssertEqual(try posts.map(playRequestBody), [pending.body, pending.body])
        XCTAssertTrue(posts.allSatisfy { playRequestHeader("Authorization", in: $0) == "Bearer \(connection.apiKey)" })
        XCTAssertTrue(posts.allSatisfy { playRequestHeader("Cookie", in: $0) == nil && playRequestHeader("Origin", in: $0) == nil })
    }

    func testMismatchedAcknowledgmentAndProtectedWriteFailurePreserveSafetyRecovery() async throws {
        let scenario = PlayHTTPScenario()
        let fixture = try PlaySafetyFixtures.load()
        scenario.set("POST /api/v1/play/safety/conduct", [try .json(fixture.completed)])
        let harness = try await PlaySafetyHarness.start(scenario: scenario)
        defer { harness.stop() }
        harness.vault.failSave = true
        do { try await harness.coordinator.acceptConduct(); XCTFail("The request must be durable before sending") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Keychain write unavailable")) }
        XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST ") })
        harness.vault.failSave = false
        do { try await harness.coordinator.acceptConduct(); XCTFail("Another action's acknowledgment must be refused") }
        catch { XCTAssertTrue(error.localizedDescription.contains("exact request is saved")) }
        let pending = try XCTUnwrap(harness.vault.load().pendingSafety)
        let request = try JSONDecoder().decode(PlayConductRequest.self, from: pending.body)
        XCTAssertNotEqual(request.actionId, fixture.completed.actionId)
        scenario.set("POST /api/v1/play/safety/conduct", [try .json(PlaySafetyCompleted(actionId: request.actionId, completed: true))])
        harness.vault.failSave = true
        do { try await harness.coordinator.retryAction(slot: .safety); XCTFail("A failed completion save must retain the same request") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Keychain write unavailable")) }
        XCTAssertEqual(try harness.vault.load().pendingSafety, pending)
        harness.vault.failSave = false
        try await harness.coordinator.retryAction(slot: .safety)
        XCTAssertNil(try harness.vault.load().pendingSafety)
        let posts = harness.server.requests.filter { $0.hasPrefix("POST ") }
        XCTAssertEqual(try posts.map(playRequestBody), [pending.body, pending.body, pending.body])
    }

    func testKeychainReloadKeepsBothPendingSlotsAndTheirScopedDrafts() throws {
        let account = "play-safety-test-\(UUID())"
        let store = PlayProtectedStore(account: account)
        defer { try? store.delete() }
        let connection = PlayTestIdentity.connection(server: URL(string: "https://school.example")!)
        let fixture = try PlaySafetyFixtures.load()
        var saved = PlayProtectedState()
        saved.pending = PlayPendingOperation(id: UUID(), connection: connection, path: "/api/v1/play/rooms",
            body: Data("{}".utf8), response: .room, baseline: nil, reconciliationUsed: false)
        saved.pendingSafety = PlayPendingOperation(id: UUID(), connection: connection,
            path: "/api/v1/play/rooms/fixture-room/reports", body: try JSONEncoder().encode(fixture.reportRequest),
            response: .safety, baseline: nil, reconciliationUsed: false)
        saved.drafts["private-turn"] = "Keep this private sentence"
        try store.save(saved)
        XCTAssertEqual(try PlayProtectedStore(account: account).load(), saved)
        let invalid = PlayPendingOperation(id: UUID(), connection: connection, path: "/api/v1/play/rooms",
            body: Data("{}".utf8), response: .room, baseline: nil, reconciliationUsed: false)
        var wrongSlot = saved
        wrongSlot.pendingSafety = invalid
        XCTAssertThrowsError(try store.save(wrongSlot))
        XCTAssertEqual(try store.load(), saved)
    }
}
