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
    var sessionId: String
    var kind: String?
    let courseId: String?
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
    let practiceLevel: SottoLearningLevel?
    let learningSelection: SottoLearningSelectionPreview.Snapshot?

    func preservingContext(kind knownKind: String?, sessionId knownId: String) -> Self {
        var response = self
        if response.kind == nil { response.kind = knownKind }
        if response.sessionId == "unavailable" { response.sessionId = knownId }
        return response
    }

    var title: String {
        switch kind {
        case "FULL": return "Full catch-up"
        case "VOCAB": return "Vocabulary practice"
        case "GRAMMAR": return "Grammar practice"
        case "READING": return "Reading practice"
        case "LISTENING": return "Listening practice"
        case "SPEAKING": return "Speaking practice"
        case "WRITING": return "Writing practice"
        default: return "Practice"
        }
    }

    var isPreparing: Bool {
        status == "preparing" && ["QUEUED", "RUNNING", "CANCELLING"].contains(preparationStatus ?? "")
    }

    var requiresWebVocabulary: Bool { status == "ready_vocabulary" }

    func vocabularyStudyURL(serverURL: URL) -> URL? {
        guard requiresWebVocabulary, let courseId else { return nil }
        var url = URLComponents(url: serverURL.appending(path: "learn/vocabulary"), resolvingAgainstBaseURL: false)
        url?.queryItems = [URLQueryItem(name: "course", value: courseId), URLQueryItem(name: "session", value: sessionId)]
        return url?.url
    }

    var preparationTitle: String {
        switch preparationStatus {
        case "QUEUED": return "Waiting to prepare"
        case "RUNNING": return "Preparing exercises"
        case "CANCELLING": return "Cancelling practice"
        case "CANCELLED": return "Practice cancelled"
        case "FAILED": return "Practice generation failed"
        case "UNRESOLVED": return "Practice interrupted"
        case "COMPLETED": return "Preparation finished"
        default: return "Checking practice status"
        }
    }

    var preparationDetail: String {
        if let message, !message.isEmpty { return message }
        switch preparationStatus {
        case "CANCELLED": return "Generation was cancelled before your practice was ready."
        case "FAILED": return "Generation could not finish. Start a new attempt from the practice menu."
        case "UNRESOLVED": return "Generation was interrupted. Check its status before recovering this attempt."
        default: return "Waiting for the server to prepare your practice."
        }
    }

    private enum CodingKeys: String, CodingKey {
        case status, sessionId, kind, courseId, reason, episodeId, items, prompts
        case speakingPrompts, writingPrompts, skillRequirements
        case learnerAnswers, writingDrafts, progressRevision, submissionResult
        case preparationStatus, message, canRecover
        case practiceLevel, learningSelection
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        status = try values.decode(String.self, forKey: .status)
        sessionId = try values.decodeIfPresent(String.self, forKey: .sessionId) ?? "unavailable"
        kind = try values.decodeIfPresent(String.self, forKey: .kind)
        courseId = try values.decodeIfPresent(String.self, forKey: .courseId)
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
        practiceLevel = try values.decodeIfPresent(SottoLearningLevel.self, forKey: .practiceLevel)
        learningSelection = try values.decodeIfPresent(SottoLearningSelectionPreview.Snapshot.self, forKey: .learningSelection)
    }
}

struct SottoPracticeOverview: Decodable, Equatable {
    struct Due: Decodable, Equatable {
        let vocab: Int
        let grammar: Int
        let objectives: Int?
        let bySkill: [String: Int]?

        func count(for kind: String) -> Int? {
            switch kind {
            case "FULL": return vocab + grammar + (objectives ?? 0)
            case "VOCAB": return vocab
            case "GRAMMAR": return grammar + (bySkill?[kind] ?? 0)
            default: return bySkill?[kind]
            }
        }
    }

    let due: Due
    let totalVocab: Int
    let recent: [SottoPracticeSessionSummary]

    var totalDue: Int { due.vocab + due.grammar + (due.objectives ?? 0) }
    var dueSummary: String {
        var parts: [String] = []
        if due.vocab > 0 { parts.append("\(due.vocab) word\(due.vocab == 1 ? "" : "s")") }
        if due.grammar > 0 { parts.append("\(due.grammar) legacy grammar point\(due.grammar == 1 ? "" : "s")") }
        if let objectives = due.objectives, objectives > 0 {
            parts.append("\(objectives) objective\(objectives == 1 ? "" : "s")")
        }
        return parts.isEmpty ? "" : "\(parts.joined(separator: " and ")) due for review."
    }
    var unfinished: [SottoPracticeSessionSummary] {
        recent.filter { $0.status == "ACTIVE" && $0.completedAt == nil }
    }
    var preparing: [SottoPracticeSessionSummary] {
        recent.filter { $0.status == "GENERATING" }
    }
    var unsuccessful: [SottoPracticeSessionSummary] {
        recent.filter { ["FAILED", "CANCELLED"].contains($0.status) }
    }
}

struct SottoPracticeSessionSummary: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let status: String
    let score: Double?
    let startedAt: String?
    let completedAt: String?

    var statusLabel: String {
        switch status {
        case "ACTIVE": return "In progress"
        case "GENERATING": return "Preparing"
        case "FAILED": return "Generation failed"
        case "CANCELLED": return "Cancelled"
        default: return "Completed"
        }
    }

    var actionLabel: String { status == "ACTIVE" ? "Resume" : "View status" }
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
