import XCTest

@testable import Sotto

@MainActor
final class PlayMissionRecoveryTests: XCTestCase {
    func testMissionOutcomeReconcilesOnlyWhileItsVisibleConversationIsUnchanged() async throws {
        let fixtures = try PlayTestFixtures.load()
        for changedConversation in [false, true] {
            let before = try fixtures.room("playing-GUEST", round: "message-4-4-GUEST", revision: 10)
            let concurrent = try fixtures.room("playing-GUEST",
                round: changedConversation ? "message-5-4-GUEST" : "one-outcome-4-GUEST", revision: 11)
            let after = try fixtures.room("playing-GUEST", round: "both-outcomes-4-GUEST", revision: 12)
            let scenario = PlayHTTPScenario()
            scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), try .json(concurrent)])
            scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [.denied(409), try .json(after)])
            let server = try LocalHTTPServer { scenario.respond($0) }
            try await server.start()
            defer { server.stop() }
            let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url, id: "guest-profile"),
                session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
            let coordinator = model.play
            coordinator.navigate(.room(before.id))
            let polling = Task { await coordinator.foreground() }
            defer { polling.cancel(); coordinator.endForeground() }
            try await waitForPlay("The mission is visible") { coordinator.room != nil }
            do {
                try await coordinator.command(.missionDone(true), in: before)
                XCTAssertFalse(changedConversation, "A changed conversation needs a new explicit outcome.")
            } catch {
                XCTAssertTrue(changedConversation)
                guard case SottoAPIError.http(409, _) = error else { return XCTFail("Expected 409, got \(error)") }
            }
            XCTAssertEqual(server.requests.filter { $0.hasPrefix("POST ") }.count, changedConversation ? 1 : 2)
            XCTAssertNil(coordinator.state?.pending)
            XCTAssertEqual(coordinator.room?.round, changedConversation ? concurrent.round : after.round)
        }
    }

    func testRecoveredFeedbackClearsOnlyItsMatchingDraftAndPreservesANewerEdit() async throws {
        let fixtures = try PlayTestFixtures.load()
        for edited in [false, true] {
            let before = try fixtures.room("playing-GUEST", round: "guessed-2-GUEST", revision: 10)
            let after = try fixtures.room("playing-GUEST", round: "finished-2-GUEST", revision: 11)
            let scenario = PlayHTTPScenario()
            scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before)])
            scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [.denied(503), try .json(after)])
            let server = try LocalHTTPServer { scenario.respond($0) }
            try await server.start()
            defer { server.stop() }
            let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url, id: "guest-profile"),
                session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
            let coordinator = model.play
            coordinator.navigate(.room(before.id))
            let polling = Task { await coordinator.foreground() }
            defer { polling.cancel(); coordinator.endForeground() }
            try await waitForPlay("Partner feedback is visible") { coordinator.room != nil }
            let key = coordinator.draftKey(room: before, round: try XCTUnwrap(before.round), action: .feedback)
            coordinator.saveDraft("Eine Giraffe", key: key)
            do { try await coordinator.command(.feedback(understood: true, correction: "Eine Giraffe"), in: before) }
            catch { guard case SottoAPIError.http(503, _) = error else { return XCTFail("Expected 503, got \(error)") } }
            if edited { coordinator.saveDraft("Ein neuer Entwurf", key: key) }
            try await coordinator.retryAction()
            XCTAssertEqual(coordinator.state?.drafts[key], edited ? "Ein neuer Entwurf" : nil)
            XCTAssertNil(coordinator.state?.pending)
        }
    }
}
