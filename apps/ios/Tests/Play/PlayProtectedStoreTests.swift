import XCTest

@testable import Sotto

final class PlayProtectedStoreTests: XCTestCase {
    func testKeychainReloadPreservesExactIntakeProofAndPriorConnectionWithoutUserDefaults() throws {
        let account = "play-test-\(UUID())"
        let store = PlayProtectedStore(account: account)
        defer { try? store.delete() }
        let invitation = try PlayInvitation(serverURL: URL(string: "https://school.example")!, code: "ABCDEFGHJK23")
        let candidate = PlayJoinCandidate(kind: .new, expectedProfileId: nil, name: "Ana",
            settings: PlaySettings(), consentToProfile: true)
        let request = PlayJoinRequest(requestId: UUID(), code: invitation.code, deviceName: "Ana's iPhone", candidate: candidate)
        let recovery = PlayAdmissionRecovery(invitation: invitation, command: request, proof: try PlayInvitation.newProof(), existingConnection: nil)
        var state = PlayProtectedState()
        state.admission = recovery
        try state.archive(PlayTestIdentity.connection(server: URL(string: "https://old.example")!))
        try store.save(state)
        let reloaded = try PlayProtectedStore(account: account).load()
        XCTAssertEqual(reloaded, state)
        XCTAssertEqual(reloaded.admission?.command, request)
        try store.delete()
        XCTAssertNil(try store.load().admission)
    }

    func testUnreadableProtectedDataIsPreservedInsteadOfOverwritten() throws {
        let account = "play-test-corrupt-\(UUID())"
        let raw = CredentialStore(account: account)
        defer { try? raw.delete() }
        let bytes = Data("unreadable saved game credential".utf8)
        try raw.saveData(bytes)
        XCTAssertThrowsError(try PlayProtectedStore(account: account).load())
        XCTAssertEqual(try raw.loadData(), bytes)
    }

    func testArchiveCapacityRefusesToDiscardAUniqueConnection() throws {
        var state = PlayProtectedState()
        for index in 0..<16 {
            try state.archive(PlayTestIdentity.connection(server: URL(string: "https://server\(index).example")!))
        }
        let original = state
        XCTAssertThrowsError(try state.archive(PlayTestIdentity.connection(server: URL(string: "https://new.example")!)))
        XCTAssertEqual(state, original)
    }
}
