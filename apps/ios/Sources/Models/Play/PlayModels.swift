import Foundation

enum PlaySeat: String, Codable { case host = "HOST", guest = "GUEST" }
enum PlayKind: String, Codable, CaseIterable {
    case mixed = "MIXED", knowMe = "KNOW_ME", describe = "DESCRIBE", mission = "MISSION"
    var title: String {
        switch self {
        case .mixed: "A little of everything"
        case .knowMe: "Pick for each other"
        case .describe: "Describe and guess"
        case .mission: "Secret mission"
        }
    }
}
enum PlayTheme: String, Codable, CaseIterable {
    case everyday = "EVERYDAY", food = "FOOD", travel = "TRAVEL", silly = "SILLY"
    case getToKnowYou = "GET_TO_KNOW_YOU", affectionate = "AFFECTIONATE"
    var title: String { rawValue.replacingOccurrences(of: "_", with: " ").capitalized }
}
enum PlayLevel: String, Codable, CaseIterable { case A1, A2, B1, B2, C1, C2 }
enum PlayQuestionStyle: String, Codable { case choices = "CHOICES", open = "OPEN" }
enum PlayRoomStatus: String, Codable {
    case waiting = "WAITING", playing = "PLAYING", completed = "COMPLETED"
    case cancelled = "CANCELLED", expired = "EXPIRED"
}
enum PlayRoomAction: String, Codable {
    case start = "START", nextRound = "NEXT_ROUND", rematch = "REMATCH"
    case leave = "LEAVE", cancel = "CANCEL"
}
struct PlaySettings: Codable, Equatable {
    var nativeLang: String = "en"
    var targetLang: String = "es"
    var level: PlayLevel = .A1
    var isValid: Bool {
        let pattern = "^[a-z]{2,3}$"
        return nativeLang.range(of: pattern, options: .regularExpression) != nil
            && targetLang.range(of: pattern, options: .regularExpression) != nil
            && nativeLang != targetLang
    }
}
struct PlayMember: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let settings: PlaySettings
}
struct PlayRoom: Codable, Equatable, Identifiable {
    let id: String
    let status: PlayRoomStatus
    let revision: Int
    let rematchRoomId: String?
    let kind: PlayKind
    let theme: PlayTheme
    let questionStyle: PlayQuestionStyle
    let ownSeat: PlaySeat
    let host: PlayMember
    let guest: PlayMember?
    let hostWaiting: Bool
    let allowedActions: [PlayRoomAction]
    let round: PlayRound?
    let completedRounds: [PlayRound]
    let points: Int
    let serverTime: String
    var ownMember: PlayMember? { ownSeat == .host ? host : guest }
}
struct PlayRoomList: Decodable {
    let rooms: [PlayRoom]
    let nextCursor: String?
}
enum PlayPhraseKind: String, Codable, CaseIterable { case word = "WORD", phrase = "PHRASE", sentence = "SENTENCE" }
struct PlayPhrase: Codable, Equatable, Identifiable {
    let id: String
    let roomId: String
    let roundId: String
    let kind: PlayPhraseKind
    let text: String
    let contextText: String?
    let targetLang: String
    let createdAt: String
}
struct PlayPhraseList: Decodable {
    let phrases: [PlayPhrase]
    let nextCursor: String?
}
