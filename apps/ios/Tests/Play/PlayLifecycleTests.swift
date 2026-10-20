import XCTest

@testable import Sotto

@MainActor
final class PlayLifecycleTests: XCTestCase {
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
