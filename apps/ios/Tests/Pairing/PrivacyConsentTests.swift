import XCTest

@testable import Sotto

@MainActor
final class PrivacyConsentTests: XCTestCase {
    func testAcceptedPermissionSurvivesRelaunchFromKeychain() throws {
        let store = CredentialStore(account: "consent-test-\(UUID().uuidString)")
        defer { try? store.delete() }
        let first = SottoAppModel(credentials: credentials(), credentialStore: store)
        XCTAssertFalse(first.hasAIConsent)
        first.acceptAIProcessing()
        XCTAssertTrue(first.hasAIConsent)
        let relaunched = SottoAppModel(credentialStore: store)
        XCTAssertTrue(relaunched.isPaired)
        XCTAssertTrue(relaunched.hasAIConsent)
        XCTAssertEqual(relaunched.activeProfile?.id, "alice")
        XCTAssertEqual(relaunched.credentials?.apiKey, "fixture-key")
    }

    func testExistingPairingRemainsReadableAndRequiresPermission() throws {
        let legacy = #"{"serverURL":"https://school.example","apiKey":"fixture-key","selectedProfile":{"id":"alice","name":"Alice","avatarUrl":"","isOwner":true,"role":"ADMIN"}}"#
        let paired = try JSONDecoder().decode(SottoCredentials.self, from: Data(legacy.utf8))
        let model = SottoAppModel(credentials: paired, credentialStore: ConsentPersistence())
        XCTAssertTrue(model.isPaired)
        XCTAssertFalse(model.hasAIConsent)
    }

    func testPermissionBelongsToOneServerAndLearner() throws {
        let store = ConsentPersistence()
        let model = SottoAppModel(credentials: credentials(), credentialStore: store)
        model.acceptAIProcessing()
        let accepted = try XCTUnwrap(store.load())
        var otherProfile = accepted
        otherProfile.selectedProfile = profile("bob")
        XCTAssertFalse(SottoAppModel(credentials: otherProfile, credentialStore: store).hasAIConsent)
        let otherServer = SottoCredentials(serverURL: URL(string: "https://other.example")!,
            apiKey: accepted.apiKey, user: nil, selectedProfile: accepted.selectedProfile,
            acceptedAIScopes: accepted.acceptedAIScopes)
        XCTAssertFalse(SottoAppModel(credentials: otherServer, credentialStore: store).hasAIConsent)
    }

    func testSwitchingLearnersKeepsEachLearnersSavedPermission() async throws {
        let store = ConsentPersistence()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ConsentCoursesProtocol.self]
        let session = URLSession(configuration: configuration)
        let model = SottoAppModel(credentials: credentials(), session: session, credentialStore: store)
        model.acceptAIProcessing()
        model.clearSelectedProfile()
        XCTAssertFalse(model.hasSelectedProfile)
        await model.selectProfile(profile("bob"))
        XCTAssertFalse(model.hasAIConsent)
        model.acceptAIProcessing()
        await model.selectProfile(profile("alice"))
        XCTAssertTrue(model.hasAIConsent)
        let relaunched = SottoAppModel(session: session, credentialStore: store)
        await relaunched.selectProfile(profile("bob"))
        XCTAssertTrue(relaunched.hasAIConsent)
    }

    func testFailedSaveDoesNotGrantPermission() {
        let store = ConsentPersistence()
        store.saveFailure = true
        let model = SottoAppModel(credentials: credentials(), credentialStore: store)
        model.acceptAIProcessing()
        XCTAssertFalse(model.hasAIConsent)
        XCTAssertNil(store.saved)
        XCTAssertTrue(model.errorMessage?.contains("could not be saved") == true)
    }

    func testUnpairingRemovesSavedPermission() {
        let store = ConsentPersistence()
        let model = SottoAppModel(credentials: credentials(), credentialStore: store)
        model.acceptAIProcessing()
        XCTAssertTrue(model.signOut())
        let relaunched = SottoAppModel(credentialStore: store)
        XCTAssertFalse(relaunched.isPaired)
        XCTAssertFalse(relaunched.hasAIConsent)
    }

    func testFailedWithdrawalReportsErrorAndKeepsPairingUntilDeletionSucceeds() {
        let store = ConsentPersistence()
        let model = SottoAppModel(credentials: credentials(), credentialStore: store)
        model.acceptAIProcessing()
        store.deleteFailure = true
        XCTAssertFalse(model.signOut())
        XCTAssertTrue(model.isPaired)
        XCTAssertTrue(model.hasAIConsent)
        XCTAssertTrue(model.errorMessage?.contains("Keychain unavailable") == true)
        XCTAssertTrue(SottoAppModel(credentialStore: store).isPaired)
        store.deleteFailure = false
        XCTAssertTrue(model.signOut())
        XCTAssertFalse(SottoAppModel(credentialStore: store).isPaired)
    }

    private func credentials() -> SottoCredentials {
        SottoCredentials(serverURL: URL(string: "https://school.example")!,
            apiKey: "fixture-key", user: nil, selectedProfile: profile("alice"))
    }

    private func profile(_ id: String) -> SottoProfile {
        SottoProfile(id: id, name: id.capitalized, avatarUrl: "", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
    }
}

private final class ConsentPersistence: SottoCredentialPersistence {
    var saved: Data?
    var saveFailure = false
    var deleteFailure = false

    func load() throws -> SottoCredentials? {
        try saved.map { try JSONDecoder().decode(SottoCredentials.self, from: $0) }
    }
    func save(_ credentials: SottoCredentials) throws {
        if saveFailure { throw SottoAPIError.message("Keychain unavailable") }
        saved = try JSONEncoder().encode(credentials)
    }
    func delete() throws {
        if deleteFailure { throw SottoAPIError.message("Keychain unavailable") }
        saved = nil
    }
}

private final class ConsentCoursesProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"courses":[]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
