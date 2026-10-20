import Foundation

enum PlayPhase: String, Codable {
    case setup = "SETUP", clue = "CLUE", guess = "GUESS", answer = "ANSWER"
    case exchange = "EXCHANGE", feedback = "FEEDBACK", finished = "FINISHED"
}
enum PlayRole: String, Codable { case learner = "LEARNER", partner = "PARTNER" }
enum PlayActionType: String, Codable {
    case setTarget = "SET_TARGET", giveClue = "GIVE_CLUE", guess = "GUESS"
    case answer = "ANSWER", choose = "CHOOSE", message = "MESSAGE"
    case missionDone = "MISSION_DONE", hint = "HINT", feedback = "FEEDBACK", skip = "SKIP"
}
enum PlayOption: String, Codable, CaseIterable { case A, B, C, D }
struct PlayChoice: Codable, Equatable, Identifiable {
    let id: PlayOption
    let text: String
    let supportText: String?
    let symbol: String
}
struct PlayMessage: Codable, Equatable {
    let seat: PlaySeat
    let text: String
}
struct PlayResult: Codable, Equatable {
    let skipped: Bool
    let understood: Bool?
    let matched: Bool?
    let correction: String?
    let points: Int
}
struct PlayDescribe: Codable, Equatable {
    let targetSuggestions: [PlayChoice]?
    let target: String?
    let clue: String?
    let guess: String?
}
struct PlayPrediction: Codable, Equatable {
    let questionStyle: PlayQuestionStyle
    let choices: [PlayChoice]
    let ownAnswer: String?
    let otherAnswer: String?
    let otherCommitted: Bool
    func answerLabel(_ answer: String) -> String {
        questionStyle == .choices ? choices.first(where: { $0.id.rawValue == answer })?.text ?? answer : answer
    }
}
struct PlayMission: Codable, Equatable {
    let ownObjective: String
    let otherObjective: String?
    let messages: [PlayMessage]
    let remainingMessages: Int
    let twist: String?
    let ownOutcome: Bool?
    let otherOutcome: Bool?
}
enum PlayRoundContent: Equatable {
    case describe(PlayDescribe), prediction(PlayPrediction), mission(PlayMission)
}
struct PlayRound: Codable, Equatable, Identifiable {
    let id: String
    let order: Int
    let learner: PlaySeat
    let targetLang: String
    let supportLang: String
    let level: PlayLevel
    let prompt: String
    let guidance: String
    let phase: PlayPhase
    let role: PlayRole
    let instruction: String
    let revealed: Bool
    let allowedActions: [PlayActionType]
    let hints: [PlayMessage]
    let result: PlayResult?
    let content: PlayRoundContent

    private enum CodingKeys: String, CodingKey {
        case id, order, learner, targetLang, supportLang, level, prompt, guidance, phase
        case role, instruction, revealed, allowedActions, hints, result, mode
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        order = try c.decode(Int.self, forKey: .order)
        learner = try c.decode(PlaySeat.self, forKey: .learner)
        targetLang = try c.decode(String.self, forKey: .targetLang)
        supportLang = try c.decode(String.self, forKey: .supportLang)
        level = try c.decode(PlayLevel.self, forKey: .level)
        prompt = try c.decode(String.self, forKey: .prompt)
        guidance = try c.decode(String.self, forKey: .guidance)
        phase = try c.decode(PlayPhase.self, forKey: .phase)
        role = try c.decode(PlayRole.self, forKey: .role)
        instruction = try c.decode(String.self, forKey: .instruction)
        revealed = try c.decode(Bool.self, forKey: .revealed)
        allowedActions = try c.decode([PlayActionType].self, forKey: .allowedActions)
        hints = try c.decode([PlayMessage].self, forKey: .hints)
        result = try c.decodeIfPresent(PlayResult.self, forKey: .result)
        switch try c.decode(PlayKind.self, forKey: .mode) {
        case .describe: content = .describe(try PlayDescribe(from: decoder))
        case .knowMe: content = .prediction(try PlayPrediction(from: decoder))
        case .mission: content = .mission(try PlayMission(from: decoder))
        case .mixed:
            throw DecodingError.dataCorruptedError(forKey: .mode, in: c, debugDescription: "A round needs one game.")
        }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(order, forKey: .order)
        try c.encode(learner, forKey: .learner)
        try c.encode(targetLang, forKey: .targetLang)
        try c.encode(supportLang, forKey: .supportLang)
        try c.encode(level, forKey: .level)
        try c.encode(prompt, forKey: .prompt)
        try c.encode(guidance, forKey: .guidance)
        try c.encode(phase, forKey: .phase)
        try c.encode(role, forKey: .role)
        try c.encode(instruction, forKey: .instruction)
        try c.encode(revealed, forKey: .revealed)
        try c.encode(allowedActions, forKey: .allowedActions)
        try c.encode(hints, forKey: .hints)
        try c.encode(result, forKey: .result)
        switch content {
        case let .describe(value):
            try c.encode(PlayKind.describe, forKey: .mode)
            try value.encode(to: encoder)
        case let .prediction(value):
            try c.encode(PlayKind.knowMe, forKey: .mode)
            try value.encode(to: encoder)
        case let .mission(value):
            try c.encode(PlayKind.mission, forKey: .mode)
            try value.encode(to: encoder)
        }
    }
    /// Only participant language content is eligible for the private notebook.
    var visibleTexts: [String] {
        var texts = hints.map(\.text)
        if let correction = result?.correction { texts.append(correction) }
        switch content {
        case let .describe(value):
            texts += (value.targetSuggestions ?? []).map(\.text)
            texts += [value.target, value.clue, value.guess].compactMap { $0 }
        case let .prediction(value):
            if value.questionStyle == .choices { texts += value.choices.map(\.text) }
            else { texts += [value.ownAnswer, value.otherAnswer].compactMap { $0 } }
        case let .mission(value): texts += value.messages.map(\.text)
        }
        var seen = Set<String>()
        return texts.filter { seen.insert($0).inserted }
    }
}
