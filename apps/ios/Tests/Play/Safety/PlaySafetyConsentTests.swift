import XCTest

@testable import Sotto

@MainActor
final class PlaySafetyConsentTests: XCTestCase {
    private func legacy(_ harness: PlaySafetyHarness, existing: Bool = false, delivery: PlayDelivery? = nil) throws -> PlayAdmissionRecovery {
        let invite = try PlayInvitation(serverURL: harness.server.url, code: "ABCDEFGHJK23")
        let candidate = PlayJoinCandidate(kind: existing ? .existing : .new,
            expectedProfileId: existing ? "host-profile" : nil, name: existing ? nil : "Sam",
            settings: PlaySettings(), consentToProfile: existing ? nil : true)
        let recovery = PlayAdmissionRecovery(invitation: invite,
            command: PlayJoinRequest(requestId: UUID(), code: invite.code, deviceName: "Original device", candidate: candidate),
            proof: try PlayInvitation.newProof(), existingConnection: existing ? harness.model.credentials : nil, delivery: delivery)
        try harness.coordinator.save { $0.admission = recovery; $0.invitation = invite }
        return recovery
    }

    private func status(_ pending: PlayAdmissionRecovery, _ value: String = "WAITING_FOR_OWNER") -> LocalHTTPServer.Response {
        .json("{\"requestId\":\"\(pending.command.requestId.uuidString)\",\"status\":\"\(value)\",\"expiresAt\":\"2099-01-01T00:00:00Z\",\"serverTime\":\"2026-10-21T12:00:00Z\"}")
    }

    func testFreshIntakeRequiresExplicitConductBeforeSavingOrUploadingNameAndRetriesExactAcceptedCommand() async throws {
        let scenario = PlayHTTPScenario()
        scenario.set("POST /api/v1/play/invitations", [.denied(503)])
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .join)
        defer { harness.stop() }
        let invite = try PlayInvitation(serverURL: harness.server.url, code: "ABCDEFGHJK23")
        try harness.coordinator.save { $0.invitation = invite }
        do { try await harness.coordinator.join(settings: PlaySettings(), name: "Private proposed name", existing: false, acceptedConduct: false)
            XCTFail("Name upload requires explicit conduct acceptance") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Read and accept")) }
        XCTAssertNil(try harness.vault.load().admission)
        XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST ") })
        do { try await harness.coordinator.join(settings: PlaySettings(), name: "Sam", existing: false, acceptedConduct: true)
            XCTFail("The uncertain intake must remain saved") }
        catch { guard case SottoAPIError.http(503, _) = error else { throw error } }
        let pending = try XCTUnwrap(harness.vault.load().admission)
        XCTAssertEqual(pending.command.acceptedConductVersion, 1)
        XCTAssertEqual(pending.command.candidate.name, "Sam")
        scenario.set("POST /api/v1/play/invitations", [status(pending, "WAITING_FOR_HOST")])
        try await harness.coordinator.retryIntake()
        XCTAssertEqual(try harness.vault.load().admission, pending)
        let posts = harness.server.requests.filter { $0.hasPrefix("POST /api/v1/play/invitations ") }
        XCTAssertEqual(posts.count, 2)
        XCTAssertEqual(try posts.map { try JSONDecoder().decode(PlayJoinRequest.self, from: playRequestBody($0)) },
            [pending.command, pending.command])
        XCTAssertTrue(posts.allSatisfy { playRequestHeader("X-Sotto-Play-Proof", in: $0) == pending.proof })
    }

    func testKnownUnversionedRequestsOnlyProbeAndExplicitConductPreservesOriginalBodyAndProofWhileWaiting() async throws {
        for existing in [false, true] {
            let scenario = PlayHTTPScenario()
            let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .join)
            defer { harness.stop() }
            let pending = try legacy(harness, existing: existing)
            let path = "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)"
            scenario.set("GET \(path)", [status(pending)])
            scenario.set("POST \(path)/conduct", [.json("{\"requestId\":\"\(pending.command.requestId.uuidString)\",\"version\":1}")])
            try await harness.coordinator.retryIntake()
            XCTAssertEqual(harness.coordinator.joinStatus, .waitingForOwner)
            XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST ") })
            do { try await harness.coordinator.finishAdmission(); XCTFail("Legacy requests require explicit conduct") }
            catch { XCTAssertTrue(error.localizedDescription.contains("Accept the current game conduct")) }
            try await harness.coordinator.acceptSavedAdmissionConduct()
            let accepted = try XCTUnwrap(harness.vault.load().admission)
            XCTAssertEqual(accepted.command, pending.command)
            XCTAssertEqual(accepted.proof, pending.proof)
            XCTAssertEqual(accepted.existingConnection, pending.existingConnection)
            XCTAssertEqual(accepted.conductVersion, 1)
            try await harness.coordinator.retryIntake()
            let posts = harness.server.requests.filter { $0.hasPrefix("POST ") }
            XCTAssertEqual(posts.count, 1)
            XCTAssertTrue(try XCTUnwrap(posts.first).hasPrefix("POST \(path)/conduct "))
            struct Acceptance: Decodable { let version: Int }
            XCTAssertEqual(try JSONDecoder().decode(Acceptance.self, from: playRequestBody(posts[0])).version, 1)
            XCTAssertEqual(playRequestHeader("X-Sotto-Play-Proof", in: posts[0]), pending.proof)
            XCTAssertEqual(playRequestHeader("Authorization", in: posts[0]), existing ? "Bearer \(try XCTUnwrap(harness.model.credentials).apiKey)" : nil)
        }
    }

    func testUnknownLegacyRequestRequiresExplicitRetentionBeforeANewIDAndProofAndRefusesFullArchive() async throws {
        for statusCode in [401, 404] {
            let scenario = PlayHTTPScenario()
            let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .join)
            defer { harness.stop() }
            let pending = try legacy(harness)
            let path = "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)"
            scenario.set("GET \(path)", [.denied(statusCode)])
            do { try await harness.coordinator.retryIntake(); XCTFail("Unknown legacy intake may not be reposted") }
            catch { guard case SottoAPIError.http(statusCode, _) = error else { throw error } }
            XCTAssertEqual(try harness.vault.load().admission, pending)
            XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST ") })
            let retained = try (0..<16).map { index in
                PlayAdmissionRecovery(invitation: pending.invitation,
                    command: PlayJoinRequest(requestId: UUID(), code: pending.invitation.code,
                        deviceName: "Earlier request \(index)", candidate: pending.command.candidate),
                    proof: try PlayInvitation.newProof(), existingConnection: nil)
            }
            try harness.coordinator.save { $0.retainedAdmissions = retained }
            do { try await harness.coordinator.retainUnknownLegacyAdmission(); XCTFail("A full archive may not discard a recovery") }
            catch { XCTAssertTrue(error.localizedDescription.contains("Remove a saved invitation recovery")) }
            XCTAssertEqual(try harness.vault.load().admission, pending)
            try harness.coordinator.save { $0.retainedAdmissions = [] }
            try await harness.coordinator.retainUnknownLegacyAdmission()
            XCTAssertNil(try harness.vault.load().admission)
            XCTAssertEqual(try harness.vault.load().retainedAdmissions, [pending])
            scenario.set("POST /api/v1/play/invitations", [.denied(503)])
            do { try await harness.coordinator.join(settings: PlaySettings(), name: "Sam", existing: false, acceptedConduct: false)
                XCTFail("Retention does not imply consent to a fresh upload") }
            catch { XCTAssertTrue(error.localizedDescription.contains("Read and accept")) }
            do { try await harness.coordinator.join(settings: PlaySettings(), name: "Sam", existing: false, acceptedConduct: true)
                XCTFail("Expected uncertain fresh intake") }
            catch { guard case SottoAPIError.http(503, _) = error else { throw error } }
            let fresh = try XCTUnwrap(harness.vault.load().admission)
            XCTAssertNotEqual(fresh.command.requestId, pending.command.requestId)
            XCTAssertNotEqual(fresh.proof, pending.proof)
            XCTAssertEqual(fresh.command.acceptedConductVersion, 1)
            XCTAssertEqual(try harness.vault.load().retainedAdmissions, [pending])
        }
    }

    func testIssuedLegacyCredentialAcceptsConductByOriginalProofBeforeCanonicalVerificationAndAck() async throws {
        let scenario = PlayHTTPScenario()
        let harness = try await PlaySafetyHarness.start(scenario: scenario, screen: .join)
        defer { harness.stop() }
        let delivery = PlayDelivery(kind: .native, deliveryId: "already-issued", roomId: "fixture-room",
            profile: PlayMember(id: "guest-profile", name: "Sam", settings: PlaySettings()),
            token: "already-issued-principal-bound-device-token", expiresAt: "2099-01-01T00:00:00Z")
        let pending = try legacy(harness, delivery: delivery)
        let path = "/api/v1/play/join-requests/\(pending.command.requestId.uuidString)"
        scenario.set("GET \(path)", [status(pending, "CLAIMED")])
        scenario.set("POST \(path)/conduct", [.json("{\"requestId\":\"\(pending.command.requestId.uuidString)\",\"version\":1}")])
        scenario.set("GET /api/v1/profiles", [try .json(["profiles": [PlayTestIdentity.profile("guest-profile")]])])
        scenario.set("GET /api/v1/play/rooms/fixture-room", [try .json(PlayTestFixtures.load().room("playing-GUEST"))])
        scenario.set("POST \(path)/ack", [.denied(503), .json("{\"acknowledged\":true}")])
        do { try await harness.coordinator.finishAdmission(); XCTFail("Delivery must not bypass explicit conduct") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Accept the current game conduct")) }
        harness.vault.failSave = true
        do { try await harness.coordinator.acceptSavedAdmissionConduct(); XCTFail("Consent must be durable") }
        catch { XCTAssertTrue(error.localizedDescription.contains("Keychain write unavailable")) }
        XCTAssertEqual(try harness.vault.load().admission, pending)
        harness.vault.failSave = false
        try await harness.coordinator.acceptSavedAdmissionConduct()
        XCTAssertEqual(try harness.vault.load().admission?.command, pending.command)
        XCTAssertEqual(try harness.vault.load().admission?.delivery, delivery)
        do { try await harness.coordinator.finishAdmission(); XCTFail("An uncertain acknowledgment keeps the credential") }
        catch { guard case SottoAPIError.http(503, _) = error else { throw error } }
        XCTAssertEqual(harness.model.credentials?.apiKey, delivery.token)
        XCTAssertEqual(try harness.vault.load().admission?.delivery, delivery)
        XCTAssertEqual(try harness.vault.load().admission?.proof, pending.proof)
        try await harness.coordinator.finishAdmission()
        XCTAssertNil(try harness.vault.load().admission)
        XCTAssertEqual(harness.model.credentials?.apiKey, delivery.token)
        XCTAssertFalse(harness.server.requests.contains { $0.hasPrefix("POST /api/v1/play/invitations ") || $0.contains("/claim ") })
        let acks = harness.server.requests.filter { $0.hasPrefix("POST \(path)/ack ") }
        XCTAssertEqual(acks.count, 2)
        XCTAssertTrue(acks.allSatisfy { playRequestHeader("X-Sotto-Play-Proof", in: $0) == pending.proof
            && playRequestHeader("Authorization", in: $0) == nil })
    }
}
