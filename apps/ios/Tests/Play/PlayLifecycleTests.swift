import XCTest

@testable import Sotto

@MainActor
final class PlayLifecycleTests: XCTestCase {
    func testReselectingTheSameRoomKeepsTheNewForegroundAndPreservesDrafts() async throws {
        let fixtures = try PlayTestFixtures.load()
        let old = try fixtures.room(revision: 3)
        let current = try fixtures.room(revision: 4)
        let after = try fixtures.room(round: "one-pick-0-HOST", revision: 5)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(old, delay: 1), try .json(current)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try .json(after)])
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .room(current.id))
        defer { harness.stop() }
        try await waitForPlay("The first room request is in flight") {
            harness.server.requests.contains { $0.hasPrefix("GET /api/v1/play/rooms/fixture-room ") }
        }
        try harness.coordinator.save { $0.drafts["turn"] = "Keep this draft" }
        harness.coordinator.navigate(.room(current.id))
        XCTAssertTrue(harness.coordinator.gameControlsDisabled)
        let replacement = Task { await harness.coordinator.foreground() }
        defer { replacement.cancel(); harness.coordinator.endForeground() }
        try await waitForPlay("The replacement foreground displays the current room") {
            harness.coordinator.room == current && !harness.coordinator.gameControlsDisabled
        }
        await harness.polling.value
        try await Task.sleep(for: .seconds(1))
        let cancelledForeground = Task { await harness.coordinator.foreground() }
        cancelledForeground.cancel()
        await cancelledForeground.value
        XCTAssertTrue(harness.coordinator.active)
        XCTAssertEqual(harness.coordinator.room, current)
        XCTAssertEqual(try harness.vault.load().drafts["turn"], "Keep this draft")
        harness.coordinator.run { try await harness.coordinator.command(.choose(.A), in: current) }
        try await waitForPlay("One choice reaches the current room") { harness.coordinator.room == after }
        XCTAssertEqual(harness.server.requests.filter { $0.hasPrefix("POST /api/v1/play/rooms/fixture-room/actions ") }.count, 1)
    }

    func testSavingVisibleLanguageSendsRequiredNullOrSelectedContextAndCompletesRecovery() async throws {
        let room = try PlayTestFixtures.load().room(round: "finished-0-HOST")
        let round = try XCTUnwrap(room.round)
        let text = try XCTUnwrap(round.visibleTexts.first)
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(room)])
        let server = try LocalHTTPServer { request in
            guard request.hasPrefix("POST /api/v1/play/phrases ") else { return scenario.respond(request) }
            guard let body = request.components(separatedBy: "\r\n\r\n").last?.data(using: .utf8),
                  var object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
                  object["contextText"] != nil else { return .denied(400) }
            object["id"] = "saved-phrase"
            object["targetLang"] = round.targetLang
            object["createdAt"] = "2026-10-20T12:00:00Z"
            guard let data = try? JSONSerialization.data(withJSONObject: object) else { return .denied(400) }
            return .json(String(decoding: data, as: UTF8.self))
        }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: vault)
        let coordinator = model.play
        coordinator.navigate(.room(room.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The source round is visible") { coordinator.room == room }
        for context in ["", text] {
            try await coordinator.keep(text: text, context: context, kind: .word, round: round)
            XCTAssertEqual(coordinator.notice, "Saved privately to your notebook.")
            XCTAssertEqual(coordinator.phrases.first?.text, text)
            XCTAssertNil(try vault.load().pending)
        }
        let bodies = try server.requests.filter { $0.hasPrefix("POST /api/v1/play/phrases ") }.map {
            try XCTUnwrap(JSONSerialization.jsonObject(with: Data(XCTUnwrap($0.components(separatedBy: "\r\n\r\n").last).utf8)) as? [String: Any])
        }
        XCTAssertEqual(bodies.count, 2)
        XCTAssertTrue(bodies.first?["contextText"] is NSNull)
        XCTAssertEqual(bodies.last?["contextText"] as? String, text)
    }

    func testWaitingHostReleasesItsNonceAndUsesANewNonceOnForegroundReentry() async throws {
        let template = try PlayTestFixtures.load().room()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(template)) as? [String: Any])
        object["status"] = "WAITING"; object["round"] = NSNull(); object["guest"] = NSNull()
        object["allowedActions"] = ["CANCEL"]
        let waiting = try JSONDecoder().decode(PlayRoom.self, from: JSONSerialization.data(withJSONObject: object))
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(waiting)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/presence", [.json("{\"hostWaiting\":true,\"expiresAt\":null,\"serverTime\":\"2026-10-20T12:00:00Z\"}")])
        scenario.set("GET /api/v1/play/rooms/fixture-room/invitations", [.json("null")])
        scenario.set("GET /api/v1/play/rooms/fixture-room/join-requests", [.json("{\"requests\":[]}")])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.room(waiting.id))
        let first = Task { await coordinator.foreground() }
        defer { first.cancel(); coordinator.endForeground() }
        try await waitForPlay("The foreground host is waiting") { coordinator.leaseReady }
        coordinator.endForeground()
        try await waitForPlay("The old view releases its lease") {
            server.requests.contains { $0.hasPrefix("POST ") && $0.contains("RELEASE") }
        }
        XCTAssertFalse(coordinator.leaseReady)
        let second = Task { await coordinator.foreground() }
        defer { second.cancel(); coordinator.endForeground() }
        try await waitForPlay("The host is waiting again") { coordinator.leaseReady }
        struct PresenceBody: Decodable { let type: String; let viewNonce: String }
        let requests = try server.requests.filter { $0.hasPrefix("POST ") }.map {
            try JSONDecoder().decode(PresenceBody.self, from: Data(XCTUnwrap($0.components(separatedBy: "\r\n\r\n").last).utf8))
        }
        let renewals = requests.filter { $0.type == "RENEW" }
        XCTAssertEqual(renewals.count, 2)
        XCTAssertNotEqual(renewals.first?.viewNonce, renewals.last?.viewNonce)
        XCTAssertEqual(requests.first(where: { $0.type == "RELEASE" })?.viewNonce, renewals.first?.viewNonce)
    }

    func testNotebookRevocationClearsPreviouslyLoadedPrivatePhrases() async throws {
        let scenario = PlayHTTPScenario()
        let phrase = PlayPhrase(id: "secret", roomId: "fixture-room", roundId: "round", kind: .word,
            text: "Regenschirm", contextText: nil, targetLang: "de", createdAt: "2026-10-20T12:00:00Z")
        scenario.set("GET /api/v1/play/phrases", [try .json(["phrases": [phrase]])])
        scenario.set("GET /api/v1/play/phrases?limit=1", [.denied()])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
        let coordinator = model.play
        coordinator.navigate(.notebook)
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The private phrase is visible") { coordinator.phrases.first?.id == phrase.id }
        do { try await coordinator.refresh(coordinator.epoch); XCTFail("Revoked access must be refused.") }
        catch { }
        XCTAssertTrue(coordinator.accessRevoked)
        XCTAssertTrue(coordinator.phrases.isEmpty)
        XCTAssertNil(coordinator.phrasesCursor)
    }

    func testPendingActionAllowsRestoringItsExactOriginalConnection() async throws {
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms", [.json("{\"rooms\":[],\"nextCursor\":null}")])
        scenario.set("GET /api/v1/play/enrollments", [.denied()])
        scenario.set("GET /api/v1/profiles", [try .json(["profiles": [PlayTestIdentity.profile()]])])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let original = PlayTestIdentity.connection(server: server.url)
        let other = PlayTestIdentity.connection(server: server.url, id: "guest-profile")
        let vault = PlayMemoryStore()
        var saved = PlayProtectedState()
        saved.pending = PlayPendingOperation(id: UUID(), connection: original, path: "/api/v1/play/rooms",
            body: Data("{}".utf8), response: .room, baseline: nil, reconciliationUsed: false)
        try vault.save(saved)
        let model = SottoAppModel(credentials: other, session: URLSession(configuration: .ephemeral),
            credentialStore: PlayCredentialMemoryStore(), playStore: vault)
        let coordinator = model.play
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The current connection is bound") { coordinator.boundConnection == other }
        try await coordinator.switchConnection(original)
        XCTAssertEqual(model.credentials, original)
        XCTAssertEqual(try vault.load().pending?.connection, original)
        XCTAssertTrue(try vault.load().archivedConnections.contains(other))
        let request = try XCTUnwrap(server.requests.first { $0.hasPrefix("GET /api/v1/profiles ") })
        XCTAssertTrue(request.lowercased().contains("authorization: bearer \(original.apiKey)"))
    }
}
