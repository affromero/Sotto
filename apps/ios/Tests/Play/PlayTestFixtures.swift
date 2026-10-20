import XCTest

@testable import Sotto

struct PlayTestFixtures: Decodable {
    struct Round: Decodable { let name: String; let seat: PlaySeat; let round: PlayRound; let visibleTexts: [String] }
    struct Room: Decodable { let name: String; let room: PlayRoom }
    let version: Int
    let rounds: [Round]
    let rooms: [Room]
    static func load() throws -> Self {
        let url = try XCTUnwrap(Bundle(for: PlayContractsTests.self).url(forResource: "contract", withExtension: "json"))
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
    func room(_ name: String = "playing-HOST", round: String? = nil, revision: Int? = nil) throws -> PlayRoom {
        let value = try XCTUnwrap(rooms.first { $0.name == name }?.room)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
        if let round {
            let selected = try XCTUnwrap(rounds.first { $0.name == round }?.round)
            object["round"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(selected))
            if selected.phase == .finished { object["allowedActions"] = ["NEXT_ROUND", "LEAVE", "CANCEL"] }
        }
        if let revision { object["revision"] = revision }
        return try JSONDecoder().decode(PlayRoom.self, from: JSONSerialization.data(withJSONObject: object))
    }
}

final class PlayMemoryStore: PlayProtectedPersistence {
    var data: Data?
    var failSave = false
    var failDelete = false
    func load() throws -> PlayProtectedState {
        try data.map { try JSONDecoder().decode(PlayProtectedState.self, from: $0) } ?? PlayProtectedState()
    }
    func save(_ state: PlayProtectedState) throws {
        if failSave { throw SottoAPIError.message("Keychain write unavailable") }
        try state.validate()
        data = try JSONEncoder().encode(state)
    }
    func delete() throws {
        if failDelete { throw SottoAPIError.message("Keychain deletion unavailable") }
        data = nil
    }
}
final class PlayCredentialMemoryStore: SottoCredentialPersistence {
    var saved: SottoCredentials?
    var failSave = false
    func load() throws -> SottoCredentials? { saved }
    func save(_ credentials: SottoCredentials) throws {
        if failSave { throw SottoAPIError.message("Credential write unavailable") }
        saved = credentials
    }
    func delete() throws { saved = nil }
}

enum PlayTestIdentity {
    static func profile(_ id: String = "host-profile") -> SottoProfile {
        SottoProfile(id: id, name: id == "host-profile" ? "Alex" : "Sam", avatarUrl: "",
            isOwner: false, role: "USER", courseCount: nil, primaryCourse: nil, isActive: true)
    }
    static func connection(server: URL, id: String = "host-profile") -> SottoCredentials {
        SottoCredentials(serverURL: server, apiKey: "fixture-\(id)-device-credential", user: nil, selectedProfile: profile(id))
    }
}
