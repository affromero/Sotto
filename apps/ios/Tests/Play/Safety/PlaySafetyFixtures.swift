import XCTest

@testable import Sotto

struct PlaySafetyFixtures: Decodable {
    struct Failure: Decodable { let status: Int; let body: PlaySafetyFailure }
    let version: Int
    let policy: PlaySafetyPolicy
    let unaccepted: PlaySafetyStatus
    let accepted: PlaySafetyStatus
    let restricted: PlaySafetyStatus
    let blocks: PlayBlockList
    let reportRequest: PlayReportRequest
    let report: PlaySafetyReport
    let completed: PlaySafetyCompleted
    let errors: [Failure]

    static func load() throws -> Self {
        let url = try XCTUnwrap(Bundle(for: PlayContractsTests.self).url(forResource: "safety", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }

    func status(profile: String, accepted: Bool = true, restricted: Bool = false) -> PlaySafetyStatus {
        let value = restricted ? self.restricted : accepted ? self.accepted : unaccepted
        return PlaySafetyStatus(profileId: profile, acceptedVersion: value.acceptedVersion, acceptedAt: value.acceptedAt,
            sharingRestricted: value.sharingRestricted, canReviewReports: value.canReviewReports, serverTime: value.serverTime)
    }
}

func playRequestBody(_ request: String) throws -> Data {
    Data(try XCTUnwrap(request.components(separatedBy: "\r\n\r\n").last).utf8)
}

func playRequestHeader(_ name: String, in request: String) -> String? {
    request.components(separatedBy: "\r\n\r\n").first?.components(separatedBy: "\r\n")
        .first { $0.lowercased().hasPrefix("\(name.lowercased()):") }?
        .split(separator: ":", maxSplits: 1).last.map { $0.trimmingCharacters(in: .whitespaces) }
}

func playSafetyCompleted(_ request: String) -> LocalHTTPServer.Response {
    struct Identity: Decodable { let actionId: UUID }
    do {
        let identity = try JSONDecoder().decode(Identity.self, from: playRequestBody(request))
        return try .json(PlaySafetyCompleted(actionId: identity.actionId, completed: true))
    } catch { return .denied(400) }
}

@MainActor
struct PlaySafetyHarness {
    let server: LocalHTTPServer
    let vault: PlayMemoryStore
    let model: SottoAppModel
    let coordinator: PlayCoordinator
    let polling: Task<Void, Never>

    static func start(scenario: PlayHTTPScenario, saved: PlayProtectedState = PlayProtectedState(),
                      profile: String = "host-profile", screen: PlayScreen = .safety) async throws -> Self {
        let server = try LocalHTTPServer { scenario.respond($0) }
        try await server.start()
        let vault = PlayMemoryStore()
        try vault.save(saved)
        let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: server.url, id: profile),
            session: URLSession(configuration: .ephemeral), credentialStore: PlayCredentialMemoryStore(), playStore: vault)
        let coordinator = model.play
        coordinator.navigate(screen)
        let polling = Task { await coordinator.foreground() }
        try await waitForPlay("The canonical safety status is loaded for this profile") {
            coordinator.safetyStatus?.profileId == profile && coordinator.safetyPolicy != nil
        }
        return Self(server: server, vault: vault, model: model, coordinator: coordinator, polling: polling)
    }

    func stop() { polling.cancel(); coordinator.endForeground(); server.stop() }
}
