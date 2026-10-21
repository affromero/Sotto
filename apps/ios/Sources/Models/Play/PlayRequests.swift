import Foundation

enum PlayCommand: Codable, Equatable {
    case text(PlayActionType, String), choose(PlayOption), missionDone(Bool)
    case feedback(understood: Bool, correction: String?), skip
    var type: PlayActionType {
        switch self {
        case let .text(type, _): type
        case .choose: .choose
        case .missionDone: .missionDone
        case .feedback: .feedback
        case .skip: .skip
        }
    }
    private enum CodingKeys: String, CodingKey { case type, text, optionId, achieved, understood, correction }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(PlayActionType.self, forKey: .type)
        switch type {
        case .choose: self = .choose(try c.decode(PlayOption.self, forKey: .optionId))
        case .missionDone: self = .missionDone(try c.decode(Bool.self, forKey: .achieved))
        case .feedback:
            self = .feedback(understood: try c.decode(Bool.self, forKey: .understood),
                correction: try c.decodeIfPresent(String.self, forKey: .correction))
        case .skip: self = .skip
        default: self = .text(type, try c.decode(String.self, forKey: .text))
        }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        switch self {
        case let .text(_, text): try c.encode(text, forKey: .text)
        case let .choose(id): try c.encode(id, forKey: .optionId)
        case let .missionDone(value): try c.encode(value, forKey: .achieved)
        case let .feedback(understood, correction):
            try c.encode(understood, forKey: .understood)
            try c.encode(correction, forKey: .correction)
        case .skip: break
        }
    }
}
struct PlayActionRequest: Codable, Equatable {
    let actionId: UUID
    let expectedRevision: Int
    let type: PlayRoomAction?
    let command: PlayCommand?
}
struct PlayCreateRequest: Codable, Equatable {
    let actionId: UUID
    let kind: PlayKind
    let theme: PlayTheme
    let questionStyle: PlayQuestionStyle
    let settings: PlaySettings
}
struct PlayJoinCandidate: Codable, Equatable {
    enum Kind: String, Codable { case existing = "EXISTING", new = "NEW" }
    let kind: Kind
    let expectedProfileId: String?
    let name: String?
    let settings: PlaySettings
    let consentToProfile: Bool?
}
struct PlayJoinRequest: Codable, Equatable {
    let requestId: UUID
    let code: String
    let client = "NATIVE"
    let deviceName: String
    let candidate: PlayJoinCandidate
    var acceptedConductVersion: Int? = nil
    private enum CodingKeys: String, CodingKey { case requestId, code, client, deviceName, candidate, acceptedConductVersion }
}
enum PlayJoinStatus: String, Codable {
    case waitingForOwner = "WAITING_FOR_OWNER", waitingForHost = "WAITING_FOR_HOST"
    case hostUnavailable = "HOST_UNAVAILABLE", accepted = "ACCEPTED", claimed = "CLAIMED"
    case declined = "DECLINED", expired = "EXPIRED", revoked = "REVOKED"
}
struct PlayJoinStatusView: Decodable {
    let requestId: String
    let status: PlayJoinStatus
    let expiresAt: String
    let serverTime: String
}
enum PlayApproval: String, Codable { case approveProfile = "APPROVE_PROFILE", accept = "ACCEPT", decline = "DECLINE" }
struct PlayPendingRequest: Decodable, Identifiable {
    let requestId: String
    let roomId: String
    let roomRevision: Int
    let name: String
    let candidateKind: PlayJoinCandidate.Kind
    let settings: PlaySettings
    let status: PlayJoinStatus
    let profileId: String?
    let allowedActions: [PlayApproval]
    let expiresAt: String
    let serverTime: String
    var id: String { requestId }
}
struct PlayPendingList: Decodable { let requests: [PlayPendingRequest] }
struct PlayDelivery: Codable, Equatable {
    enum Kind: String, Codable { case native = "NATIVE", existing = "EXISTING" }
    let kind: Kind
    let deliveryId: String?
    let roomId: String
    let profile: PlayMember
    let token: String?
    let expiresAt: String?
}
struct PlayPresence: Decodable {
    let hostWaiting: Bool
    let expiresAt: String?
    let serverTime: String
}
struct PlayInvitationView: Decodable {
    let roomId: String
    let code: String
    let generation: Int
    let expiresAt: String
}
struct PlayInvitationPreview: Decodable {
    let roomId: String
    let hostName: String
    let kind: PlayKind
    let theme: PlayTheme
    let questionStyle: PlayQuestionStyle
    let hostWaiting: Bool
    let expiresAt: String
    let serverTime: String
}
