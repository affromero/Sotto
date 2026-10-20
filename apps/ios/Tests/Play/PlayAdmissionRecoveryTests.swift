import XCTest

@testable import Sotto

@MainActor
final class PlayAdmissionRecoveryTests: XCTestCase {
    func testCancellationBeforeAcknowledgmentKeepsBothCredentialsAndAllowsAnotherInvitation() async throws {
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/profiles", [try .json(["profiles": [PlayTestIdentity.profile("guest-profile")]])])
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(PlayTestFixtures.load().room("playing-GUEST"))])
        scenario.set("GET /api/v1/play/join-requests/\(requestID.uuidString)", [.json(status.replacingOccurrences(of: "ACCEPTED", with: "REVOKED"))])
        scenario.set("POST /api/v1/play/join-requests/\(requestID.uuidString)/ack", [.denied()])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        var saved = PlayProtectedState()
        saved.admission = try pending(server: server.url, received: delivery)
        try vault.save(saved)
        let original = PlayTestIdentity.connection(server: server.url)
        let credentials = PlayCredentialMemoryStore()
        let model = SottoAppModel(credentials: original, session: URLSession(configuration: .ephemeral),
            credentialStore: credentials, playStore: vault)
        let coordinator = model.play
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The canceled admission is visible") { coordinator.joinStatus == .revoked }
        do { try await coordinator.finishAdmission(); XCTFail("The canceled room cannot acknowledge delivery.") }
        catch { guard case SottoAPIError.http(403, _) = error else { return XCTFail("Expected 403, got \(error)") } }
        XCTAssertEqual(credentials.saved?.apiKey, delivery.token)
        XCTAssertTrue(try vault.load().archivedConnections.contains(original))
        XCTAssertEqual(try vault.load().admission?.delivery, delivery)
        try coordinator.retainDeliveredInvitation()
        XCTAssertNil(try vault.load().admission)
        XCTAssertEqual(try vault.load().retainedAdmissions.first?.delivery, delivery)
        XCTAssertEqual(model.activeProfile?.id, delivery.profile.id)
    }

    func testNewAdmissionArchivesTheOriginalConnectionClearsPrivateCachesAndAcknowledgesTheSavedMember() async throws {
        let guestRoom = try PlayTestFixtures.load().room("playing-GUEST")
        let scenario = PlayHTTPScenario()
        let phrase = PlayPhrase(id: "private-phrase", roomId: "fixture-room", roundId: "old-round", kind: .phrase,
            text: "Old learner's private sentence", contextText: nil, targetLang: "de", createdAt: instant)
        scenario.set("GET /api/v1/play/phrases", [try .json(["phrases": [phrase]])])
        scenario.set("POST /api/v1/play/invitations", [.json(status)])
        scenario.set("GET /api/v1/profiles", [try .json(["profiles": [PlayTestIdentity.profile("guest-profile")]])])
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(guestRoom)])
        scenario.set("POST /api/v1/play/join-requests/\(requestID.uuidString)/claim", [try .json(delivery)])
        scenario.set("POST /api/v1/play/join-requests/\(requestID.uuidString)/ack", [.json("{\"acknowledged\":true}")])
        scenario.set("GET /api/v1/play/join-requests/\(requestID.uuidString)", [.json(status)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        let credentials = PlayCredentialMemoryStore()
        let original = PlayTestIdentity.connection(server: server.url)
        let model = SottoAppModel(credentials: original, session: URLSession(configuration: .ephemeral),
            credentialStore: credentials, playStore: vault)
        let coordinator = model.play
        coordinator.navigate(.notebook)
        let oldPolling = Task { await coordinator.foreground() }
        defer { oldPolling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The original learner's notebook is visible") { coordinator.phrases.first?.id == phrase.id }
        let recovery = try pending(server: server.url)
        try coordinator.save { $0.admission = recovery; $0.invitation = recovery.invitation }
        coordinator.navigate(.join)
        let joining = Task { await coordinator.foreground() }
        defer { joining.cancel(); coordinator.endForeground() }
        try await waitForPlay("The saved admission is accepted") { coordinator.joinStatus == .accepted }
        try await coordinator.finishAdmission()
        XCTAssertEqual(model.activeProfile?.id, "guest-profile")
        XCTAssertEqual(credentials.saved?.apiKey, delivery.token)
        XCTAssertTrue(coordinator.phrases.isEmpty)
        XCTAssertTrue(coordinator.rooms.isEmpty)
        XCTAssertNil(coordinator.ownerCapability)
        XCTAssertTrue(try vault.load().archivedConnections.contains(original))
        XCTAssertNil(try vault.load().admission)
        XCTAssertFalse(model.hasAIConsent)
        XCTAssertEqual(coordinator.screen, .room("fixture-room"))
        let ack = try XCTUnwrap(server.requests.first { $0.contains("/ack ") })
        XCTAssertTrue(ack.lowercased().contains("x-sotto-play-proof:"))
        XCTAssertFalse(ack.lowercased().contains("authorization:"))
        XCTAssertFalse(server.requests.contains { $0.contains("/api/v1/courses") })
    }

    func testFailedArchiveWriteKeepsTheOriginalDefaultAndReceivedCredentialWithoutAcknowledgment() async throws {
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/profiles", [try .json(["profiles": [PlayTestIdentity.profile("guest-profile")]])])
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(PlayTestFixtures.load().room("playing-GUEST"))])
        scenario.set("GET /api/v1/play/join-requests/\(requestID.uuidString)", [.json(status)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        var saved = PlayProtectedState()
        saved.admission = try pending(server: server.url, received: delivery)
        try vault.save(saved)
        let original = PlayTestIdentity.connection(server: server.url)
        let credentials = PlayCredentialMemoryStore()
        let model = SottoAppModel(credentials: original, session: URLSession(configuration: .ephemeral),
            credentialStore: credentials, playStore: vault)
        let coordinator = model.play
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The saved delivery can be resumed") { coordinator.joinStatus == .accepted }
        vault.failSave = true
        do { try await coordinator.finishAdmission(); XCTFail("An archive write must succeed before replacing the default.") }
        catch { XCTAssertTrue(error.localizedDescription.contains("write unavailable")) }
        XCTAssertEqual(model.credentials, original)
        XCTAssertNil(credentials.saved)
        XCTAssertEqual(try vault.load().admission?.delivery, delivery)
        XCTAssertFalse(server.requests.contains { $0.contains("/ack ") })
    }

    func testRevokedDeliveryCanBeKeptWithoutBlockingAnotherInvitationOrLosingArchivedConnections() async throws {
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/profiles", [.denied()])
        scenario.set("GET /api/v1/play/join-requests/\(requestID.uuidString)", [.json(status.replacingOccurrences(of: "ACCEPTED", with: "REVOKED"))])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let vault = PlayMemoryStore()
        var saved = PlayProtectedState()
        let recovery = try pending(server: server.url, received: delivery)
        saved.admission = recovery
        let original = PlayTestIdentity.connection(server: server.url)
        try saved.archive(original)
        try vault.save(saved)
        let model = SottoAppModel(credentials: original, session: URLSession(configuration: .ephemeral),
            credentialStore: PlayCredentialMemoryStore(), playStore: vault)
        let coordinator = model.play
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The revoked admission is visible") { coordinator.joinStatus == .revoked }
        do { try await coordinator.finishAdmission(); XCTFail("A revoked device must fail verification.") }
        catch { guard case SottoAPIError.http(403, _) = error else { return XCTFail("Expected 403, got \(error)") } }
        try coordinator.retainDeliveredInvitation()
        XCTAssertEqual(try vault.load().retainedAdmissions, [recovery])
        XCTAssertTrue(try vault.load().archivedConnections.contains(original))
        XCTAssertNil(try vault.load().admission)
        let another = try PlayInvitation(serverURL: server.url, code: "JK23ABCDEFGH")
        coordinator.receive(another.appURL.absoluteString)
        XCTAssertEqual(coordinator.state?.invitation, another)
        XCTAssertEqual(model.credentials, original)
    }

    func testExistingAdmissionKeepsTheOriginalCredentialAndNeverSendsAnAcknowledgment() async throws {
        let scenario = PlayHTTPScenario()
        let room = try PlayTestFixtures.load().room("playing-GUEST")
        let existingDelivery = PlayDelivery(kind: .existing, deliveryId: nil, roomId: room.id,
            profile: room.guest!, token: nil, expiresAt: nil)
        scenario.set("GET /api/v1/play/join-requests/\(requestID.uuidString)", [.json(status)])
        scenario.set("POST /api/v1/play/join-requests/\(requestID.uuidString)/claim", [try .json(existingDelivery)])
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(room)])
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        defer { server.stop() }
        let original = PlayTestIdentity.connection(server: server.url, id: "guest-profile")
        let invite = try PlayInvitation(serverURL: server.url, code: "ABCDEFGHJK23")
        let candidate = PlayJoinCandidate(kind: .existing, expectedProfileId: "guest-profile", name: nil,
            settings: PlaySettings(), consentToProfile: nil)
        var saved = PlayProtectedState()
        saved.admission = PlayAdmissionRecovery(invitation: invite,
            command: PlayJoinRequest(requestId: requestID, code: invite.code, deviceName: "Fixture device", candidate: candidate),
            proof: try PlayInvitation.newProof(), existingConnection: original)
        let vault = PlayMemoryStore()
        try vault.save(saved)
        let credentials = PlayCredentialMemoryStore()
        let model = SottoAppModel(credentials: original, session: URLSession(configuration: .ephemeral),
            credentialStore: credentials, playStore: vault)
        let coordinator = model.play
        let polling = Task { await coordinator.foreground() }
        defer { polling.cancel(); coordinator.endForeground() }
        try await waitForPlay("The existing admission is accepted") { coordinator.joinStatus == .accepted }
        try await coordinator.finishAdmission()
        XCTAssertEqual(model.credentials, original)
        XCTAssertNil(credentials.saved)
        XCTAssertNil(try vault.load().admission)
        XCTAssertFalse(server.requests.contains { $0.contains("/ack ") })
        let claim = try XCTUnwrap(server.requests.first { $0.contains("/claim ") })
        XCTAssertTrue(claim.lowercased().contains("authorization: bearer \(original.apiKey)"))
        XCTAssertTrue(claim.lowercased().contains("x-sotto-play-proof:"))
    }

    private let instant = "2026-10-20T12:00:00.000Z"
    private let requestID = UUID(uuidString: "41C4FCF1-AD6A-4289-AAD6-2B30B8910BE1")!
    private var status: String {
        "{\"requestId\":\"\(requestID.uuidString)\",\"status\":\"ACCEPTED\",\"expiresAt\":\"\(instant)\",\"serverTime\":\"\(instant)\"}"
    }
    private var delivery: PlayDelivery {
        PlayDelivery(kind: .native, deliveryId: "fixture-delivery", roomId: "fixture-room",
            profile: PlayMember(id: "guest-profile", name: "Sam", settings: PlaySettings()),
            token: "fixture-new-guest-device-credential", expiresAt: instant)
    }
    private func pending(server: URL, received: PlayDelivery? = nil) throws -> PlayAdmissionRecovery {
        let invite = try PlayInvitation(serverURL: server, code: "ABCDEFGHJK23")
        return PlayAdmissionRecovery(invitation: invite,
            command: PlayJoinRequest(requestId: requestID, code: invite.code, deviceName: "Fixture device",
                candidate: PlayJoinCandidate(kind: .new, expectedProfileId: nil, name: "Sam", settings: PlaySettings(), consentToProfile: true)),
            proof: try PlayInvitation.newProof(), existingConnection: nil, delivery: received)
    }
}
