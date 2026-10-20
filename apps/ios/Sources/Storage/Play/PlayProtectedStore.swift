import Foundation

protocol PlayProtectedPersistence {
    func load() throws -> PlayProtectedState
    func save(_ state: PlayProtectedState) throws
    func delete() throws
}

struct PlayAdmissionRecovery: Codable, Equatable {
    let invitation: PlayInvitation
    let command: PlayJoinRequest
    let proof: String
    /// Existing admissions always retain the original device and selection.
    let existingConnection: SottoCredentials?
    var delivery: PlayDelivery?
}

enum PlayOperationResponse: String, Codable { case room, invitation, approval, phrase }
struct PlayPendingOperation: Codable, Equatable {
    let id: UUID
    let connection: SottoCredentials
    let path: String
    let body: Data
    let response: PlayOperationResponse
    let baseline: PlayRoom?
    let reconciliationUsed: Bool
}
struct PlayProtectedState: Codable, Equatable {
    var version = 1
    var invitation: PlayInvitation?
    var admission: PlayAdmissionRecovery?
    var retainedAdmissions: [PlayAdmissionRecovery] = []
    var archivedConnections: [SottoCredentials] = []
    var pending: PlayPendingOperation?
    var drafts: [String: String] = [:]

    mutating func archive(_ credentials: SottoCredentials) throws {
        if let index = archivedConnections.firstIndex(where: {
            $0.serverURL == credentials.serverURL && $0.selectedProfile?.id == credentials.selectedProfile?.id
                && $0.apiKey == credentials.apiKey
        }) {
            archivedConnections[index] = credentials
            return
        }
        guard archivedConnections.count < 16 else {
            throw SottoAPIError.message("Remove a saved connection before adding another.")
        }
        archivedConnections.append(credentials)
    }

    func validate() throws {
        guard version == 1, archivedConnections.count <= 16, retainedAdmissions.count <= 16, drafts.count <= 64,
              drafts.allSatisfy({ $0.key.count <= 500 && $0.value.count <= 500 }),
              archivedConnections.allSatisfy({ PlayInvitation.origin($0.serverURL) != nil && !$0.apiKey.isEmpty }) else {
            throw SottoAPIError.message("Saved game data cannot be read safely. It has been preserved.")
        }
        for admission in [admission].compactMap({ $0 }) + retainedAdmissions {
            guard admission.proof.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  admission.command.code == admission.invitation.code,
                  admission.command.candidate.settings.isValid,
                  admission.command.deviceName.count <= 80,
                  (admission.command.candidate.kind == .existing) == (admission.existingConnection != nil),
                  admission.existingConnection.map({ $0.serverURL == admission.invitation.serverURL
                      && $0.selectedProfile?.id == admission.command.candidate.expectedProfileId }) ?? true else {
                throw SottoAPIError.message("Saved invitation recovery is invalid. It has been preserved.")
            }
        }
        if let pending {
            guard pending.path.hasPrefix("/api/v1/play/"), pending.body.count <= 16_384,
                  PlayInvitation.origin(pending.connection.serverURL) != nil,
                  pending.connection.selectedProfile != nil else {
                throw SottoAPIError.message("Saved game action is invalid. It has been preserved.")
            }
        }
    }
}

struct PlayProtectedStore: PlayProtectedPersistence {
    private let store: CredentialStore
    init(account: String = "partner-play-v1") { store = CredentialStore(account: account) }

    func load() throws -> PlayProtectedState {
        guard let data = try store.loadData() else { return PlayProtectedState() }
        guard data.count <= 262_144 else { throw SottoAPIError.message("Saved game data exceeds the supported size.") }
        let state = try JSONDecoder().decode(PlayProtectedState.self, from: data)
        try state.validate()
        return state
    }
    func save(_ state: PlayProtectedState) throws {
        try state.validate()
        let data = try JSONEncoder().encode(state)
        guard data.count <= 262_144 else { throw SottoAPIError.message("Saved game data is full. Remove an old connection or draft.") }
        try store.saveData(data)
    }
    func delete() throws { try store.delete() }
}
