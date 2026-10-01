import Foundation

struct SottoSkillRequirements: Decodable, Equatable {
    struct Requirement: Decodable, Equatable {
        let state: String
        let expectedCount: Int?
    }
    let skills: [String: Requirement]
    let referenceAudioRequired: Bool

    var exemptions: [String] {
        skills.keys.sorted().filter { skills[$0]?.state == "EXEMPT_NO_PROVIDER" }
    }
}

struct SottoPracticeChoiceFeedback: Decodable, Equatable, Identifiable {
    let itemId: String
    let prompt: String
    let selectedAnswer: String
    let correctAnswer: String
    let correct: Bool
    let explanation: String
    var id: String { itemId }
}

struct SottoPracticeWritingFeedback: Decodable, Equatable, Identifiable {
    let promptId: String
    let task: String
    let grade: SottoWritingResponse
    var id: String { promptId }
}

struct SottoPracticeSpeakingFeedback: Decodable, Equatable, Identifiable {
    let promptId: String
    let targetPhrase: String
    let evidence: SottoSpeakingPollResponse
    var id: String { promptId }
}

struct SottoPracticeStart: Decodable, Identifiable, Equatable {
    var id: String { sessionId }
    let status: String
    let sessionId: String
    let kind: String?
    let reason: String?
    let episodeId: String?
    let items: [SottoPracticeItem]?
    let speakingPrompts: [SottoSpeakingPrompt]?
    let writingPrompts: [SottoWritingPrompt]?
    let skillRequirements: SottoSkillRequirements?
    let learnerAnswers: [String: Int]?
    let writingDrafts: [String: String]?
    let progressRevision: Int?
    let submissionResult: SottoPracticeSubmitResult?
    let preparationStatus: String?
    let message: String?
    let canRecover: Bool?

    private enum CodingKeys: String, CodingKey {
        case status, sessionId, kind, reason, episodeId, items, prompts
        case speakingPrompts, writingPrompts, skillRequirements
        case learnerAnswers, writingDrafts, progressRevision, submissionResult
        case preparationStatus, message, canRecover
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        status = try values.decode(String.self, forKey: .status)
        sessionId = try values.decodeIfPresent(String.self, forKey: .sessionId) ?? "unavailable"
        kind = try values.decodeIfPresent(String.self, forKey: .kind)
        reason = try values.decodeIfPresent(String.self, forKey: .reason)
        episodeId = try values.decodeIfPresent(String.self, forKey: .episodeId)
        items = try values.decodeIfPresent([SottoPracticeItem].self, forKey: .items)
        speakingPrompts = try values.decodeIfPresent([SottoSpeakingPrompt].self,
            forKey: status == "ready_speaking" ? .prompts : .speakingPrompts)
        writingPrompts = try values.decodeIfPresent([SottoWritingPrompt].self,
            forKey: status == "ready_writing" ? .prompts : .writingPrompts)
        skillRequirements = try values.decodeIfPresent(SottoSkillRequirements.self, forKey: .skillRequirements)
        learnerAnswers = try values.decodeIfPresent([String: Int].self, forKey: .learnerAnswers)
        writingDrafts = try values.decodeIfPresent([String: String].self, forKey: .writingDrafts)
        progressRevision = try values.decodeIfPresent(Int.self, forKey: .progressRevision)
        submissionResult = try values.decodeIfPresent(SottoPracticeSubmitResult.self, forKey: .submissionResult)
        preparationStatus = try values.decodeIfPresent(String.self, forKey: .preparationStatus)
        message = try values.decodeIfPresent(String.self, forKey: .message)
        canRecover = try values.decodeIfPresent(Bool.self, forKey: .canRecover)
    }
}

struct SottoLearningProgressResponse: Decodable {
    let progressRevision: Int
}

extension SottoSpeakingRecording {
    private enum EvidenceKeys: String, CodingKey {
        case id, recordingId, status, transcript, overallScore, rubricScores, phonemeScores, feedback
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: EvidenceKeys.self)
        id = try values.decodeIfPresent(String.self, forKey: .id) ?? values.decode(String.self, forKey: .recordingId)
        status = try values.decode(String.self, forKey: .status)
        transcript = try values.decodeIfPresent(String.self, forKey: .transcript)
        overallScore = try values.decodeIfPresent(Double.self, forKey: .overallScore)
        rubricScores = try values.decodeIfPresent([String: Double].self, forKey: .rubricScores)
        phonemeScores = try values.decodeIfPresent([SottoSpeakingAlignmentToken].self, forKey: .phonemeScores)
        feedback = try values.decodeIfPresent(String.self, forKey: .feedback)
    }
}
