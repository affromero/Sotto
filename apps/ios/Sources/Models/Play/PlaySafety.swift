import Foundation

struct PlaySafetyFailure: Decodable, LocalizedError {
    enum Reason: String, Decodable {
        case conductRequired = "CONDUCT_REQUIRED", sharingRestricted = "SHARING_RESTRICTED"
        case unavailable = "PLAY_UNAVAILABLE", textFiltered = "TEXT_FILTERED"
        case contentChanged = "CONTENT_CHANGED", conflict = "SAFETY_CONFLICT"
        var status: Int {
            switch self {
            case .unavailable: 404
            case .textFiltered: 400
            default: 409
            }
        }
    }
    let error: String
    let reason: Reason
    var errorDescription: String? { error }
}

struct PlaySafetyPolicy: Codable, Equatable {
    let version: Int
    let title: String
    let paragraphs: [String]
    let operatorContactUrl: String?
    let termsPath: String
    let privacyPath: String
    let reviewPath: String

    func validate() throws {
        guard version == 1, !title.isEmpty, title.count <= 100,
              (1...8).contains(paragraphs.count),
              paragraphs.allSatisfy({ !$0.isEmpty && $0.count <= 1000 }),
              termsPath == "/terms", privacyPath == "/privacy",
              reviewPath == "/play/safety/review",
              operatorContactUrl.map({ $0.count <= 1000 && URL(string: $0)?.scheme == "mailto" }) ?? true else {
            throw SottoAPIError.message("This server's game conduct policy is unsupported. Update Sotto before sharing.")
        }
    }
}

struct PlaySafetyStatus: Codable, Equatable {
    let profileId: String
    let acceptedVersion: Int?
    let acceptedAt: String?
    let sharingRestricted: Bool
    let canReviewReports: Bool
    let serverTime: String
}

struct PlaySafetyCompleted: Codable, Equatable {
    let actionId: UUID
    let completed: Bool
}

struct PlayBlock: Codable, Equatable, Identifiable {
    let blockedUserId: String
    let name: String
    let createdAt: String
    var id: String { blockedUserId }
}
struct PlayBlockList: Codable, Equatable {
    let blocks: [PlayBlock]
    let nextCursor: String?
}

enum PlayReportCategory: String, Codable, CaseIterable {
    case harassment = "HARASSMENT", threats = "THREATS", hate = "HATE"
    case sexualContent = "SEXUAL_CONTENT", violence = "VIOLENCE"
    case impersonation = "IMPERSONATION", other = "OTHER"
    var title: String {
        switch self {
        case .harassment: "Harassment"
        case .threats: "Threats"
        case .hate: "Hate"
        case .sexualContent: "Sexual content"
        case .violence: "Violence"
        case .impersonation: "Impersonation"
        case .other: "Other concern"
        }
    }
}

enum PlayReportField: String, Codable {
    case target = "TARGET", clue = "CLUE", guess = "GUESS", otherAnswer = "OTHER_ANSWER"
    case message = "MESSAGE", hint = "HINT", correction = "CORRECTION"
    var title: String {
        switch self {
        case .target: "Secret word"
        case .clue: "Clue"
        case .guess: "Guess"
        case .otherAnswer: "Partner's answer"
        case .message: "Message"
        case .hint: "Hint"
        case .correction: "Correction"
        }
    }
}

enum PlayReportSelector: Codable, Equatable {
    case partnerName
    case roundText(roundId: String, field: PlayReportField, index: Int?)
    private enum CodingKeys: String, CodingKey { case kind, roundId, field, index }
    private enum Kind: String, Codable { case partnerName = "PARTNER_NAME", roundText = "ROUND_TEXT" }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        switch try values.decode(Kind.self, forKey: .kind) {
        case .partnerName: self = .partnerName
        case .roundText:
            let field = try values.decode(PlayReportField.self, forKey: .field)
            let index = try values.decodeIfPresent(Int.self, forKey: .index)
            let indexed = field == .message || field == .hint
            guard indexed == (index != nil),
                  index.map({ (0...(field == .hint ? 2 : 5)).contains($0) }) ?? true else {
                throw DecodingError.dataCorruptedError(forKey: .index, in: values,
                    debugDescription: "The report position does not match the selected field.")
            }
            self = .roundText(roundId: try values.decode(String.self, forKey: .roundId), field: field, index: index)
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .partnerName: try values.encode(Kind.partnerName, forKey: .kind)
        case let .roundText(roundId, field, index):
            try values.encode(Kind.roundText, forKey: .kind)
            try values.encode(roundId, forKey: .roundId)
            try values.encode(field, forKey: .field)
            try values.encodeIfPresent(index, forKey: .index)
        }
    }
}

struct PlayReportEvidence: Codable, Equatable {
    let selector: PlayReportSelector
    let text: String
}
enum PlayReportStatus: String, Codable { case open = "OPEN", resolved = "RESOLVED" }
struct PlaySafetyReport: Codable, Equatable, Identifiable {
    let id: UUID
    let roomId: String?
    let category: PlayReportCategory
    let detail: String
    let evidence: PlayReportEvidence
    let status: PlayReportStatus
    let revision: Int
    let createdAt: String
    let response: String?
    let respondedAt: String?
}
struct PlaySafetyReportList: Codable, Equatable {
    let reports: [PlaySafetyReport]
    let nextCursor: String?
}
struct PlayReportRequest: Codable, Equatable {
    let actionId: UUID
    let category: PlayReportCategory
    let detail: String
    let selector: PlayReportSelector
    let expectedVisibleText: String
}
struct PlayConductRequest: Codable, Equatable {
    let actionId: UUID
    let version: Int
}

struct PlayReportOption: Identifiable, Equatable {
    let id: String
    let label: String
    let selector: PlayReportSelector
    let text: String
}

extension PlayRoom {
    var reportOptions: [PlayReportOption] {
        guard let guest else { return [] }
        let partner = ownSeat == .host ? guest : host
        var options = [PlayReportOption(id: "name", label: "Partner name", selector: .partnerName, text: partner.name)]
        var seen = Set<String>()
        for value in [round].compactMap({ $0 }) + completedRounds where seen.insert(value.id).inserted {
            func append(_ text: String?, field: PlayReportField, index: Int? = nil) {
                guard let text, !text.isEmpty else { return }
                options.append(PlayReportOption(id: "\(value.id)/\(field.rawValue)/\(index ?? -1)",
                    label: "Round \(value.order + 1): \(field.title)",
                    selector: .roundText(roundId: value.id, field: field, index: index), text: text))
            }
            for (index, hint) in value.hints.enumerated() where hint.seat != ownSeat {
                append(hint.text, field: .hint, index: index)
            }
            if value.learner == ownSeat { append(value.result?.correction, field: .correction) }
            switch value.content {
            case let .describe(content):
                if value.learner != ownSeat {
                    append(content.target, field: .target)
                    append(content.clue, field: .clue)
                } else { append(content.guess, field: .guess) }
            case let .prediction(content):
                if content.questionStyle == .open { append(content.otherAnswer, field: .otherAnswer) }
            case let .mission(content):
                for (index, message) in content.messages.enumerated() where message.seat != ownSeat {
                    append(message.text, field: .message, index: index)
                }
            }
        }
        return options
    }
}
