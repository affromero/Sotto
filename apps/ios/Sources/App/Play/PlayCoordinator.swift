import Foundation

enum PlayScreen: Equatable { case lobby, join, room(String), notebook }

@MainActor
final class PlayCoordinator: ObservableObject {
    weak var model: SottoAppModel?
    let session: URLSession
    let store: any PlayProtectedPersistence
    @Published var screen: PlayScreen = .lobby
    @Published var room: PlayRoom?
    @Published var rooms: [PlayRoom] = []
    var olderRooms: [PlayRoom] = []
    var openedOlderRooms = false
    @Published var roomsCursor: String?
    @Published var requests: [PlayPendingRequest] = []
    @Published var phrases: [PlayPhrase] = []
    @Published var phrasesCursor: String?
    @Published var invitation: PlayInvitationView?
    @Published var preview: PlayInvitationPreview?
    @Published var joinStatus: PlayJoinStatus?
    @Published var state: PlayProtectedState?
    @Published var error: String?
    @Published var notice: String?
    @Published var busy = false
    @Published var leaseReady = false
    @Published var accessRevoked = false
    @Published var boundConnection: SottoCredentials?
    @Published var connectionGeneration = UUID()
    var active = false
    var epoch = UUID()
    var lease: (roomID: String, nonce: String, renewed: Date, client: SottoAPIClient)?
    var ownerCapability: Bool?
    var work: Task<Void, Never>?

    init(model: SottoAppModel, session: URLSession, store: any PlayProtectedPersistence) {
        self.model = model
        self.session = session
        self.store = store
        do {
            let saved = try store.load()
            state = saved
            if saved.invitation != nil || saved.admission != nil { screen = .join }
        } catch { self.error = error.localizedDescription }
    }

    func client(_ credentials: SottoCredentials) -> SottoAPIClient {
        SottoAPIClient(serverURL: credentials.serverURL, apiKey: credentials.apiKey,
            profileId: credentials.selectedProfile?.id, session: session)
    }
    func publicClient(_ invitation: PlayInvitation) -> SottoAPIClient {
        SottoAPIClient(serverURL: invitation.serverURL, apiKey: nil, session: session)
    }
    func current(_ generation: UUID, connection: SottoCredentials?) -> Bool {
        active && !accessRevoked && epoch == generation && model?.credentials == connection && !Task.isCancelled
    }
    func requireCurrent(_ generation: UUID, connection: SottoCredentials?) throws {
        guard current(generation, connection: connection) else { throw CancellationError() }
    }
    func save(_ edit: (inout PlayProtectedState) throws -> Void) throws {
        guard var next = state else {
            throw SottoAPIError.message("Saved game data could not be opened. Unpair this device to erase it, or try again.")
        }
        try edit(&next)
        try store.save(next)
        state = next
    }
    func report(_ failure: Error) {
        guard !(failure is CancellationError), (failure as? URLError)?.code != .cancelled else { return }
        error = failure.localizedDescription
    }
    func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy, active, !accessRevoked, boundConnection == model?.credentials, state != nil else { return }
        busy = true
        error = nil
        let generation = epoch
        work = Task { [weak self] in
            guard let self else { return }
            guard self.active, self.epoch == generation, !Task.isCancelled else { return }
            defer { if self.epoch == generation { self.busy = false; self.work = nil } }
            do { try await action() }
            catch { if self.epoch == generation { self.report(error) } }
        }
    }
    @discardableResult func apply(_ value: PlayRoom) -> Bool {
        guard value.ownMember?.id == model?.credentials?.selectedProfile?.id else { return false }
        if room?.id == value.id, let room {
            guard value.revision >= room.revision else { return false }
            if value.revision == room.revision {
                let formatter = ISO8601DateFormatter()
                guard let before = ISO8601DateFormatter.sottoInternet.date(from: room.serverTime) ?? formatter.date(from: room.serverTime),
                      let after = ISO8601DateFormatter.sottoInternet.date(from: value.serverTime) ?? formatter.date(from: value.serverTime),
                      after >= before else { return false }
            }
        }
        room = value
        if value.status != .waiting { releasePresence() }
        return true
    }
    func clearMemberData() {
        room = nil
        rooms = []
        olderRooms = []
        openedOlderRooms = false
        roomsCursor = nil
        phrases = []
        phrasesCursor = nil
        requests = []
        invitation = nil
        ownerCapability = nil
    }
    func observeConnection() {
        guard boundConnection != model?.credentials else { return }
        endForeground()
        clearMemberData()
        boundConnection = model?.credentials
        connectionGeneration = UUID()
    }
    func navigate(_ destination: PlayScreen) {
        endForeground()
        room = nil
        requests = []
        invitation = nil
        preview = nil
        error = nil
        notice = nil
        screen = destination
    }
    func receive(_ value: String) {
        guard let invite = PlayInvitation.parse(value) else {
            error = "That is not a supported Sotto game invitation."
            return
        }
        do {
            if let pending = state?.admission, pending.invitation != invite {
                throw SottoAPIError.message("Finish or discard the pending invitation before opening another.")
            }
            try save { $0.invitation = invite }
            navigate(.join)
        } catch { report(error) }
    }
    func clearProtectedData() throws {
        try store.delete()
        endForeground()
        state = PlayProtectedState()
        clearMemberData()
        boundConnection = nil
        preview = nil
        screen = .lobby
    }
}
