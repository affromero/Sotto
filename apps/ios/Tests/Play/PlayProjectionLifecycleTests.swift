import XCTest

@testable import Sotto

@MainActor
final class PlayProjectionLifecycleTests: XCTestCase {
    func testHistoricalReceiptAtTheSameRevisionCannotReviveAnExpiredGame() async throws {
        let before = try changed(PlayTestFixtures.load().room(revision: 3), ["serverTime": "2026-10-20T12:00:00Z"])
        let expired = try changed(before, ["status": "EXPIRED", "round": NSNull(), "allowedActions": [],
            "serverTime": "2026-10-20T12:00:01.000Z"])
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(before), try .json(expired)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try .json(before, delay: 0.3)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = makeModel(server.url)
        let coordinator = model.play
        coordinator.navigate(.room(before.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The live round is visible") { coordinator.room == before }
        let action = Task { try await coordinator.command(.choose(.A), in: before) }
        try await waitForPlay("The original command reached the server") { server.requests.contains { $0.hasPrefix("POST ") } }
        try await coordinator.refresh(coordinator.epoch)
        XCTAssertEqual(coordinator.room, expired)
        try await action.value
        XCTAssertEqual(coordinator.room, expired)
        XCTAssertNil(coordinator.state?.pending)
    }

    func testAnOldWaitingPollCannotRecreatePresenceAfterPlayHasStarted() async throws {
        let playing = try PlayTestFixtures.load().room(revision: 3)
        let waiting = try changed(playing, ["status": "WAITING", "revision": 2, "round": NSNull(), "allowedActions": ["CANCEL"]])
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(playing), try .json(waiting)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = makeModel(server.url)
        let coordinator = model.play
        coordinator.navigate(.room(playing.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("Play has started") { coordinator.room == playing }
        try await coordinator.refresh(coordinator.epoch)
        XCTAssertEqual(coordinator.room, playing)
        XCTAssertFalse(coordinator.leaseReady)
        XCTAssertNil(coordinator.invitation)
        XCTAssertFalse(server.requests.contains { $0.contains("/presence ") || $0.contains("/invitations ") || $0.contains("/join-requests ") })
    }

    func testWaitingFollowupsCannotRestoreAnInvitationAfterAStartReceipt() async throws {
        let playing = try PlayTestFixtures.load().room(revision: 3)
        let waiting = try changed(playing, ["status": "WAITING", "revision": 2, "round": NSNull(), "allowedActions": ["START", "CANCEL"]])
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(waiting), try .json(playing)])
        scenario.set("POST /api/v1/play/rooms/fixture-room/presence", [.json("{\"hostWaiting\":true,\"expiresAt\":null,\"serverTime\":\"2026-10-20T12:00:00Z\"}")])
        var invitation = LocalHTTPServer.Response.json("{\"roomId\":\"fixture-room\",\"code\":\"ABCDEFGH2345\",\"generation\":1,\"expiresAt\":\"2099-01-01T00:00:00Z\"}")
        invitation.delay = 0.3
        scenario.set("GET /api/v1/play/rooms/fixture-room/invitations", [invitation])
        scenario.set("GET /api/v1/play/rooms/fixture-room/join-requests", [.json("{\"requests\":[]}")])
        scenario.set("POST /api/v1/play/rooms/fixture-room/actions", [try .json(playing)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let model = makeModel(server.url)
        let coordinator = model.play
        coordinator.navigate(.room(waiting.id))
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("Invitation response is in flight") { server.requests.contains { $0.hasPrefix("GET ") && $0.contains("/invitations ") } }
        try await coordinator.roomAction(.start, in: waiting)
        XCTAssertEqual(coordinator.room, playing)
        try await waitForPlay("The old lease has been released") { server.requests.contains { $0.contains("RELEASE") } }
        try await waitForPlay("The next canonical poll follows the completed invitation response") {
            server.requests.filter { $0.hasPrefix("GET /api/v1/play/rooms/fixture-room ") }.count >= 2
        }
        XCTAssertEqual(coordinator.room, playing)
        XCTAssertNil(coordinator.invitation)
        XCTAssertTrue(coordinator.requests.isEmpty)
        XCTAssertFalse(coordinator.leaseReady)
        XCTAssertFalse(server.requests.contains { $0.hasPrefix("GET ") && $0.contains("/join-requests ") })
    }

    func testEquivalentTimestampFormatsAreAcceptedAndOlderInstantsAreRefused() throws {
        let model = makeModel(URL(string: "https://sotto.example")!)
        let room = try changed(PlayTestFixtures.load().room(), ["serverTime": "2026-10-20T12:00:00Z"])
        XCTAssertTrue(model.play.apply(room))
        let equivalent = try changed(room, ["serverTime": "2026-10-20T12:00:00.000Z", "hostWaiting": false])
        XCTAssertTrue(model.play.apply(equivalent))
        let older = try changed(room, ["serverTime": "2026-10-20T11:59:59.999Z", "hostWaiting": true])
        XCTAssertFalse(model.play.apply(older))
        XCTAssertEqual(model.play.room, equivalent)
    }

    private func makeModel(_ server: URL) -> SottoAppModel {
        SottoAppModel(credentials: PlayTestIdentity.connection(server: server), session: URLSession(configuration: .ephemeral),
            credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
    }

    private func changed(_ room: PlayRoom, _ changes: [String: Any]) throws -> PlayRoom {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(room)) as? [String: Any])
        object.merge(changes) { _, new in new }
        return try JSONDecoder().decode(PlayRoom.self, from: JSONSerialization.data(withJSONObject: object))
    }
}
