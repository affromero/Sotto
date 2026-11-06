import CryptoKit
import Foundation

struct VocabularyPendingStore {
    private struct Entry: Codable { let owner: String; let scope: String; let value: Data }
    private struct State: Codable { var entries: [String: Entry] = [:] }
    private static let account = "vocabulary-pending-v1"
    private let store = CredentialStore(account: Self.account)
    private let owner: String
    private let scope: String
    private var key: String { Self.digest("\(owner)/\(scope)") }

    init(client: SottoAPIClient, scope: String) {
        owner = Self.digest("\(client.serverURL.absoluteString)/\(client.profileId ?? "")")
        self.scope = scope
    }

    func load<Value: Decodable>(_ type: Value.Type) throws -> Value? {
        guard let entry = try read().entries[key] else { return nil }
        return try JSONDecoder().decode(type, from: entry.value)
    }

    func save<Value: Codable & Equatable>(_ value: Value) throws {
        if let existing = try load(Value.self), existing != value {
            throw SottoAPIError.message("A saved vocabulary request must be resolved before starting another.")
        }
        try replace(value)
    }

    func replace<Value: Encodable>(_ value: Value) throws {
        var state = try read()
        state.entries[key] = Entry(owner: owner, scope: scope, value: try JSONEncoder().encode(value))
        let data = try JSONEncoder().encode(state)
        guard data.count <= 524_288 else { throw SottoAPIError.message("Saved vocabulary work is full. Resolve existing saved work first.") }
        try store.saveData(data)
    }

    func clear() throws {
        var state = try read()
        state.entries.removeValue(forKey: key)
        if state.entries.isEmpty { try store.delete() }
        else { try store.saveData(JSONEncoder().encode(state)) }
    }

    func pendingSessions(courseId: String) throws -> [String] {
        let prefixes = ["action/\(courseId)/", "draft/\(courseId)/"]
        let sessions = try read().entries.values.filter { $0.owner == owner }.compactMap { entry in
            prefixes.first(where: { entry.scope.hasPrefix($0) }).map { String(entry.scope.dropFirst($0.count)) }
        }
        return Array(Set(sessions)).sorted()
    }

    static func clearAll() throws { try CredentialStore(account: account).delete() }

    private func read() throws -> State {
        guard let data = try store.loadData() else { return State() }
        guard data.count <= 524_288 else { throw SottoAPIError.message("Saved vocabulary work exceeds the supported size.") }
        return try JSONDecoder().decode(State.self, from: data)
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
