import Foundation

struct SottoCredentials: Codable, Equatable {
    let serverURL: URL
    let apiKey: String
    let user: SottoUser?
    var selectedProfile: SottoProfile?
    var acceptedAIScopes: [String]? = nil
}

struct SottoUser: Codable, Equatable {
    let id: String
    let name: String?
    let email: String?
    let image: String?
    let role: String?
}

struct PairingRedeemResponse: Decodable {
    let token: String
    let user: SottoUser?
}

/// What POST /api/v1/auth/pair hands back: the same one-time token the web app
/// paints into a QR, for a client that asked for it directly.
struct PairingTokenResponse: Decodable {
    let token: String
    let serverUrl: String
    let expiresAt: String
}

struct SottoProfileListResponse: Decodable {
    let profiles: [SottoProfile]
}

struct SottoProfile: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let avatarUrl: String
    let isOwner: Bool
    let role: String
    let courseCount: Int?
    let primaryCourse: SottoProfileCourse?
    let isActive: Bool?
}

struct SottoProfileCourse: Codable, Equatable {
    let targetLang: String
    let level: String
}

struct SottoCourseListResponse: Decodable {
    let courses: [SottoCourse]
}

struct SottoCourseCreateResponse: Decodable {
    let course: SottoCourse
}

struct SottoCourse: Decodable, Identifiable, Equatable {
    let id: String
    let nativeLang: String
    let targetLang: String
    let currentLevel: String
    let startLevel: String
    let placementSource: String
    let pedagogy: SottoPedagogyStyle
    var activeClassId: String?
    let curriculum: SottoCurriculum?
    var classes: [SottoCourseClassSummary]

    private enum CodingKeys: String, CodingKey {
        case id
        case nativeLang
        case targetLang
        case currentLevel
        case startLevel
        case placementSource
        case pedagogy
        case activeClassId
        case curriculum
        case classes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        nativeLang = try container.decode(String.self, forKey: .nativeLang)
        targetLang = try container.decode(String.self, forKey: .targetLang)
        currentLevel = try container.decode(String.self, forKey: .currentLevel)
        startLevel = try container.decode(String.self, forKey: .startLevel)
        placementSource = try container.decodeIfPresent(String.self, forKey: .placementSource) ?? "UNKNOWN"
        pedagogy = try container.decodeIfPresent(SottoPedagogyStyle.self, forKey: .pedagogy) ?? .balanced
        activeClassId = try container.decodeIfPresent(String.self, forKey: .activeClassId)
        curriculum = try container.decodeIfPresent(SottoCurriculum.self, forKey: .curriculum)
        classes = try container.decodeIfPresent([SottoCourseClassSummary].self, forKey: .classes) ?? []
    }
}

struct SottoCurriculum: Decodable, Equatable {
    let title: String?
}

enum SottoPedagogyStyle: String, Codable, CaseIterable, Identifiable, Equatable {
    case balanced = "BALANCED"
    case immersion = "IMMERSION"
    case grammar = "GRAMMAR"
    case communication = "COMMUNICATION"
    case intensive = "INTENSIVE"

    var id: String { rawValue }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        self = SottoPedagogyStyle(rawValue: rawValue) ?? .balanced
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    var label: String {
        switch self {
        case .balanced:
            return "Balanced"
        case .immersion:
            return "Immersion"
        case .grammar:
            return "Grammar-first"
        case .communication:
            return "Conversation-first"
        case .intensive:
            return "Intensive review"
        }
    }

    var summary: String {
        switch self {
        case .balanced:
            return "A well-rounded mix. The default if you are not sure."
        case .immersion:
            return "Mostly target language, learn from context, meaning first."
        case .grammar:
            return "Clear rules and patterns explained up front, then practice."
        case .communication:
            return "Realistic tasks and speaking, fluency over perfection."
        case .intensive:
            return "Heavy recall and spaced repetition of weak items."
        }
    }

    var basis: String {
        switch self {
        case .balanced:
            return "Combines comprehensible input, focus on form, and retrieval practice."
        case .immersion:
            return "Krashen's input hypothesis: comprehensible input, i+1."
        case .grammar:
            return "Focus on form and explicit, deductive instruction."
        case .communication:
            return "Swain's output hypothesis and communicative language teaching."
        case .intensive:
            return "The testing effect and spaced repetition."
        }
    }
}

struct SottoCourseClassSummary: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int
    let status: String
    let attempt: Int
    let sourceTitle: String?
    let createdAt: String?
    let submittedAt: String?
    let passedAt: String?
    let failedAt: String?
    let lesson: SottoCourseLessonSummary
    let submission: SottoCourseSubmissionSummary?
}

struct SottoCourseLessonSummary: Decodable, Equatable {
    let title: String
    let level: String
}

struct SottoCourseSubmissionSummary: Decodable, Equatable {
    let overallScore: Double?
    let passed: Bool?
    let submittedAt: String?
}

struct SottoTopicSuggestion: Decodable, Identifiable, Equatable {
    var id: String { query }

    let label: String
    let query: String
}

struct SottoCourseTopicsResponse: Decodable, Equatable {
    let topics: [SottoTopicSuggestion]
}

struct SottoCourseNotesResponse: Decodable, Equatable {
    let body: String?
    let addedVocabulary: Int?
    let imported: Int?
    let failed: Int?
    let materials: [SottoCourseMaterial]?
    let nextCursor: String?
}

struct SottoCoursePedagogyResponse: Decodable, Equatable {
    let pedagogy: SottoPedagogyStyle
}

enum SottoClassGenerationSource: Equatable {
    case curriculum
    case sourceUrl(String)
    case topic(String)
}

struct NextClassCreatedResponse: Decodable {
    let classId: String?
    let activeClassId: String?
    let done: Bool?
}

struct NextClassBackgroundResponse: Decodable {
    let started: Bool
    let operationId: String?
    let courseId: String?
}

struct SottoGenerationProgress: Decodable, Equatable {
    let status: String
    let classId: String?
    let lessonTitle: String?
    let stage: String
    let detail: String
    let progress: Double
    let currentStep: Int
    let totalSteps: Int
    let elapsedSeconds: Int?
    let remainingSeconds: Int?
    let sections: [SottoGenerationSection]
    let updatedAt: String?
    let providerRequestsCompleted: Int?
    let providerRequestInFlight: Bool?
    var operationId: String? = nil
    var operationStatus: String? = nil
    var result: String? = nil
    var initialPreparation: SottoInitialPreparation? = nil
}

struct SottoInitialPreparation: Decodable, Equatable {
    let sourceUrl: String?
    let topic: String?

    var source: SottoClassGenerationSource {
        if let sourceUrl { return .sourceUrl(sourceUrl) }
        if let topic { return .topic(topic) }
        return .curriculum
    }
}

struct SottoGenerationSection: Decodable, Equatable {
    let skill: String
    let status: String
}

struct SottoLoadingOperation: Equatable {
    let title: String
    let detail: String
    let progress: Double?
    let currentStep: Int?
    let totalSteps: Int?
    let elapsedSeconds: Int?
    let remainingSeconds: Int?
    var activity: String? = nil
}

struct SottoAgentUsageStatus: Decodable, Equatable {
    let providers: [SottoAgentUsageProvider]
    let refreshedAt: String
    let cacheTtlSeconds: Int
}

struct SottoAgentUsageProvider: Decodable, Identifiable, Equatable {
    let id: String
    let category: String
    let label: String
    let shortLabel: String
    let planLabel: String?
    let status: String
    let detail: String
    let windows: [SottoAgentUsageWindow]
    let credits: SottoAgentUsageCredits?
    let limitReached: Bool
    let refreshedAt: String
}

struct SottoAgentUsageWindow: Decodable, Equatable {
    let label: String
    let usedPercent: Double
    let remainingPercent: Double
    let resetIn: String?
    let resetAt: String?
    let limitWindowSeconds: Int?
    let valueLabel: String?
    let unbounded: Bool?
}

struct SottoAgentUsageCredits: Decodable, Equatable {
    let balance: String?
    let unlimited: Bool
    let label: String?
}

struct SottoClassDetail: Decodable, Identifiable, Equatable {
    let id: String
    let courseId: String
    let status: String
    let order: Int
    let passThreshold: Double
    let sourceUrl: String?
    let sourceTitle: String?
    let lesson: SottoLesson?
    let intro: SottoClassIntro?
    let vocabulary: [SottoClassVocabularyItem]?
    let submitted: Bool
    let sections: [SottoClassSection]
    var learnerAnswers: [String: Int]? = nil
    var writingDrafts: [String: String]? = nil
    var writingHistory: [SottoWritingHistory]? = nil
    var speakingHistory: [SottoSpeakingHistory]? = nil
    var speakingHistoryUnlinked: [SottoHistoricalSpeakingRecording]? = nil
    var orphanWritingDrafts: [SottoOrphanWritingDraft]? = nil
    var quizHistory: [SottoQuizHistory]? = nil
    var orphanQuizAnswers: [SottoOrphanQuizAnswer]? = nil
    var quizHistoryUnreadable: Bool? = nil
    var quizSubmissionReceipts: [SottoQuizReceipt]? = nil
    var progressRevision: Int? = nil
    var attempt: Int? = nil
    var skillRequirements: SottoSkillRequirements? = nil
    var teaching: SottoClassTeaching? = nil
    var prerequisiteSourceHash: String? = nil
    var lessonHelpRevision: String? = nil
    var taskMaterialRevision: String? = nil
    var submission: SottoClassSavedSubmission? = nil
}

struct SottoClassSavedSubmission: Decodable, Equatable {
    let passed: Bool?
    let overallScore: Double?
    let receipt: SottoClassSubmitResult?
}

struct SottoHistoricalSpeakingRecording: Decodable, Equatable, Identifiable {
    let id: String
    let attempt: Int
    let attemptMatches: Bool?
    let status: String
    let transcript: String?
    let overallScore: Double?
    let rubricScores: [String: Double]
    let phonemeScores: [SottoSpeakingAlignmentToken]
    let detailsUnavailable: Bool
    let feedback: String?
    let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id, attempt, attemptMatches, status, transcript, overallScore, rubricScores, phonemeScores, feedback, createdAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        attempt = try values.decode(Int.self, forKey: .attempt)
        attemptMatches = try values.decodeIfPresent(Bool.self, forKey: .attemptMatches)
        status = try values.decode(String.self, forKey: .status)
        transcript = try values.decodeIfPresent(String.self, forKey: .transcript)
        overallScore = try values.decodeIfPresent(Double.self, forKey: .overallScore)
        let scores = try? values.decodeIfPresent(PartialSpeakingScores.self, forKey: .rubricScores)
        let tokens = try? values.decodeIfPresent(PartialSpeakingTokens.self, forKey: .phonemeScores)
        rubricScores = scores?.items ?? [:]
        phonemeScores = tokens?.items ?? []
        let scoresPresent = try values.contains(.rubricScores) && !values.decodeNil(forKey: .rubricScores)
        let tokensPresent = try values.contains(.phonemeScores) && !values.decodeNil(forKey: .phonemeScores)
        detailsUnavailable = (scoresPresent && scores == nil) || (tokensPresent && tokens == nil) ||
            (scores?.hasInvalid ?? false) || (tokens?.hasInvalid ?? false)
        feedback = try values.decodeIfPresent(String.self, forKey: .feedback)
        createdAt = try values.decode(String.self, forKey: .createdAt)
    }
}

private struct SpeakingScoreKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

private struct PartialSpeakingScores: Decodable {
    let items: [String: Double]
    let hasInvalid: Bool
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: SpeakingScoreKey.self)
        var accepted: [String: Double] = [:]
        var invalid = false
        for key in container.allKeys {
            if let score = try? container.decode(Double.self, forKey: key), score.isFinite {
                accepted[key.stringValue] = score
            } else { invalid = true }
        }
        items = accepted
        hasInvalid = invalid
    }
}

private struct PartialSpeakingTokens: Decodable {
    let items: [SottoSpeakingAlignmentToken]
    let hasInvalid: Bool
    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var accepted: [SottoSpeakingAlignmentToken] = []
        var invalid = false
        while !container.isAtEnd {
            let item = try container.superDecoder()
            if let token = try? SottoSpeakingAlignmentToken(from: item) { accepted.append(token) }
            else { invalid = true }
        }
        items = accepted
        hasInvalid = invalid
    }
}

struct SottoHistoricalSpeakingPrompt: Decodable, Equatable, Identifiable {
    let id: String
    let order: Int
    let targetPhrase: String
    let translation: String
    let recordings: [SottoHistoricalSpeakingRecording]
}

struct SottoSpeakingHistory: Decodable, Equatable, Identifiable {
    let sectionId: String
    let attempt: Int
    let prompts: [SottoHistoricalSpeakingPrompt]
    var id: String { sectionId }
}

struct SottoWritingHistory: Decodable, Equatable, Identifiable {
    let sectionId: String
    let attempt: Int
    let prompts: [SottoHistoricalWritingPrompt]
    var id: String { sectionId }
}

struct SottoHistoricalWritingPrompt: Decodable, Equatable, Identifiable {
    let id: String
    let order: Int
    let task: String
    let savedDraft: String?
    let responses: [SottoHistoricalWritingResponse]
}

struct SottoHistoricalWritingResponse: Decodable, Equatable, Identifiable {
    let id: String
    let text: String
    let attempt: Int
    let attemptMatches: Bool
    let overallScore: Double?
    let corrections: [SottoWritingCorrection]?
    let correctionsUnavailable: Bool
    let feedback: String?
    let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id, text, attempt, attemptMatches, overallScore, corrections, feedback, createdAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        text = try values.decode(String.self, forKey: .text)
        attempt = try values.decode(Int.self, forKey: .attempt)
        attemptMatches = try values.decode(Bool.self, forKey: .attemptMatches)
        overallScore = try values.decodeIfPresent(Double.self, forKey: .overallScore)
        do {
            let decoded = try values.decodeIfPresent(PartialWritingCorrections.self, forKey: .corrections)
            corrections = decoded?.items
            correctionsUnavailable = decoded?.hasInvalid ?? false
        } catch {
            corrections = nil
            correctionsUnavailable = true
        }
        feedback = try values.decodeIfPresent(String.self, forKey: .feedback)
        createdAt = try values.decode(String.self, forKey: .createdAt)
    }
}

private struct PartialWritingCorrections: Decodable {
    let items: [SottoWritingCorrection]
    let hasInvalid: Bool

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var accepted: [SottoWritingCorrection] = []
        var invalid = false
        while !container.isAtEnd {
            let item = try container.superDecoder()
            if let correction = try? SottoWritingCorrection(from: item) {
                accepted.append(correction)
            } else {
                invalid = true
            }
        }
        items = accepted
        hasInvalid = invalid
    }
}

struct SottoOrphanWritingDraft: Decodable, Equatable, Identifiable {
    let id: String
    let text: String
}

struct SottoQuizHistory: Decodable, Equatable, Identifiable {
    let sectionId: String
    let skill: String
    let attempt: Int
    let questions: [SottoHistoricalQuizQuestion]
    var id: String { sectionId }
}

struct SottoHistoricalQuizQuestion: Decodable, Equatable, Identifiable {
    let id: String
    let order: Int
    let question: String
    let passageText: String?
    let options: [String]?
    let savedChoice: Int?
    let submissions: [SottoHistoricalQuizSubmission]
}

struct SottoHistoricalQuizSubmission: Decodable, Equatable {
    let attempt: Int?
    let submittedAt: String?
    let selectedIndex: Int?
    let isCorrect: Bool?
}

struct SottoQuizReceipt: Decodable, Equatable {
    let attempt: Int?
    let submittedAt: String?
    let passed: Bool?
    let overallScore: Double?
    let answersUnavailable: Bool
    let passedSections: Int?
    let totalSections: Int?
    let sections: [SottoQuizReceiptSection]
    let summaryIncomplete: Bool
}

struct SottoQuizReceiptSection: Decodable, Equatable {
    let id: String?
    let skill: String?
    let score: Double?
    let passed: Bool?
}

struct SottoOrphanQuizAnswer: Decodable, Equatable {
    let sectionId: String?
    let questionId: String?
    let savedChoice: Int?
    let submissions: [SottoHistoricalQuizSubmission]
}

struct SottoClassProgressRecovery: Decodable {
    let classId: String
    let status: String
    let attempt: Int
    let progressRevision: Int
    let taskMaterialRevision: String
}

struct SottoLesson: Decodable, Equatable {
    let title: String
    let level: String
    let objective: String?
}

struct SottoClassIntro: Decodable, Equatable {
    let purpose: String
    let about: String
    let focus: [String]
    let examples: [SottoClassIntroExample]
    let tips: [String]
    let visuals: SottoClassIntroVisuals?
}

struct SottoClassIntroExample: Decodable, Equatable {
    let target: String
    let meaning: String
    let note: String
}

struct SottoClassIntroVisuals: Decodable, Equatable {
    let timeline: SottoClassTimeline?
    let contrast: SottoClassContrast?
    let callouts: [SottoClassCallout]
    let links: [SottoClassLink]
}

struct SottoClassTimeline: Decodable, Equatable {
    let title: String
    let steps: [String]
}

struct SottoClassContrast: Decodable, Equatable {
    let title: String
    let leftLabel: String
    let leftItems: [String]
    let rightLabel: String
    let rightItems: [String]
}

struct SottoClassCallout: Decodable, Equatable {
    let label: String
    let text: String
    let tone: String
}

struct SottoClassLink: Decodable, Equatable {
    let label: String
    let url: String
}

struct SottoClassVocabularyItem: Decodable, Equatable {
    let lemma: String
    let gloss: String
    let pos: String?
}

struct SottoClassSection: Decodable, Identifiable, Equatable {
    let id: String
    let skill: String
    let status: String
    let attempt: Int
    let score: Double?
    let passed: Bool?
    let episode: SottoClassEpisode?
    let questions: [SottoQuestion]
    let prompts: [SottoSpeakingPrompt]
    let writingPrompts: [SottoWritingPrompt]
}

/// The little an audio player needs from GET /api/v1/episodes/{id}. Practice
/// hands out an episode id whose audio is still being produced, so `audioUrl`
/// arrives on a later poll.
struct SottoEpisode: Decodable, Equatable {
    let id: String
    let audioUrl: String?
    let status: String?
    let segments: [SottoListeningTurn]?
}

struct SottoClassEpisode: Decodable, Equatable {
    let id: String
    let audioUrl: String?
    let status: String
    let title: String
    let failureReason: String?
    let technicalError: String?
}

struct SottoQuestion: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int
    let question: String
    let options: [String]
    let passageRef: String?
    let passageText: String?
    let correctIndex: Int?
    let explanation: String?
}

struct SottoSpeakingPrompt: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int?
    let targetPhrase: String
    let translation: String
    let ipa: String?
    let referenceTtsUrl: String?
    let latestRecording: SottoSpeakingRecording?
    let taskMode: String?
    let assessmentScope: String?
    var communicative: Bool { taskMode == "COMMUNICATIVE" }
}

struct SottoSpeakingRecording: Decodable, Equatable {
    let id: String
    let status: String
    let transcript: String?
    let overallScore: Double?
    let rubricScores: [String: Double]?
    let phonemeScores: [SottoSpeakingAlignmentToken]?
    let feedback: String?
    var recoveryAcknowledged: Bool? = nil
}

struct SottoSpeakingUploadResponse: Decodable, Equatable {
    let recordingId: String
    let status: String
}

struct SottoSpeakingPollResponse: Decodable, Equatable {
    let status: String
    let transcript: String?
    let overallScore: Double?
    let rubricScores: [String: Double]?
    let feedback: String?
    let phonemeScores: [SottoSpeakingAlignmentToken]?
    var recoveryAcknowledged: Bool? = nil
}

struct SottoSpeakingAlignmentToken: Decodable, Equatable {
    let op: String
    let expected: String?
    let actual: String?
}

struct SottoWritingPrompt: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int?
    let task: String
    let guidance: String?
    /// Latest submission first; the class detail sends at most one.
    let responses: [SottoWritingResponse]?

    var response: SottoWritingResponse? = nil
    var savedDraft: String? = nil
    var latestResponse: SottoWritingResponse? { response ?? responses?.first }
}

struct SottoWritingResponse: Decodable, Equatable {
    let text: String
    let overallScore: Double?
    let corrections: [SottoWritingCorrection]?
    let feedback: String?
}

/// One inline fix the grader suggests: what the learner wrote, what it should
/// be, and why.
struct SottoWritingCorrection: Decodable, Equatable, Identifiable {
    let old: String
    let new: String
    let why: String

    var id: String { "\(old)|\(new)" }
}

/// Response body of the class, practice, and exam writing submissions. All
/// three grade synchronously and return this same shape.
struct SottoWritingGrade: Decodable, Equatable {
    let overallScore: Double
    let corrections: [SottoWritingCorrection]
    let feedback: String
}

struct SottoPracticeItem: Decodable, Identifiable, Equatable {
    let id: String
    let prompt: String
    let options: [String]
    let passageText: String?
}

struct SottoSubmitAnswer: Encodable, Equatable {
    let questionId: String
    let selectedIndex: Int
}

struct SottoPracticeAnswer: Codable, Equatable {
    let itemId: String
    let selectedIndex: Int
}

struct SottoClassSubmitResult: Codable, Equatable {
    var source: String? = nil
    let passed: Bool
    let overallScore: Double
    let passedSections: Int
    let totalSections: Int
    let sections: [SottoClassSectionResult]
}

struct SottoSelectionHelpResponse: Decodable, Equatable {
    let text: String
    let examples: [SottoSelectionHelpExample]
}

struct SottoSelectionHelpExample: Decodable, Equatable {
    let sentence: String
    let note: String
}

struct SottoClassSectionResult: Codable, Identifiable, Equatable {
    let id: String
    let skill: String
    let score: Double
    let passed: Bool
}

struct SottoPracticeSubmitResult: Decodable, Equatable {
    let score: Double
    let correct: Int
    let total: Int
    var answered: Int? = nil
    var graded: Int? = nil
    var itemFeedback: [SottoPracticeChoiceFeedback]? = nil
    var writingFeedback: [SottoPracticeWritingFeedback]? = nil
    var speakingFeedback: [SottoPracticeSpeakingFeedback]? = nil
}

struct SottoWorksheetResponse: Decodable, Equatable {
    let document: SottoClassDocument
    let worksheetPdfUrl: String?
}

struct SottoClassDocument: Decodable, Equatable {
    let classId: String
    let title: String
    let level: String
    let objective: String
    let nativeLang: String
    let targetLang: String
    let isAnswerKey: Bool
    let sections: [SottoDocumentSection]
}

struct SottoDocumentSection: Decodable, Identifiable, Equatable {
    let id: String
    let skill: String
    let title: String
    let instructions: String
    let questions: [SottoQuestion]
    let prompts: [SottoSpeakingPrompt]
    let writingPrompts: [SottoWritingPrompt]
    let appLink: String?
    let qrDataUrl: String?
}

// MARK: - Server admin (read-only)

/// `GET /api/v1/health`. Admin callers additionally get `checks`.
struct SottoHealth: Decodable, Equatable {
    let status: String
    let checks: [String: SottoHealthCheck]?

    var isHealthy: Bool { status == "healthy" }
}

struct SottoHealthCheck: Decodable, Equatable {
    let status: String
    let latencyMs: Int?
    let detail: String?

    var isOk: Bool { status == "ok" }
}

struct SottoQueueSnapshot: Decodable, Equatable {
    let queues: [String: SottoQueueDepth]

    var backlog: Int { queues.values.reduce(0) { $0 + $1.waiting + $1.active } }
    var failed: Int { queues.values.reduce(0) { $0 + $1.failed } }
}

struct SottoQueueDepth: Decodable, Equatable {
    let waiting: Int
    let active: Int
    let completed: Int
    let failed: Int
    let delayed: Int
}

/// One row of `GET /api/v1/admin/model-pricing`. Only the fields the read-only
/// screen shows are decoded; the route sends more.
struct SottoModelPrice: Decodable, Identifiable, Equatable {
    let modelId: String
    let inputPerMTok: Double?
    let outputPerMTok: Double?

    var id: String { modelId }
}

struct SottoApiKeySummary: Decodable, Identifiable, Equatable {
    let id: String
    let name: String?
    let keyPrefix: String
    let lastUsedAt: String?
    let createdAt: String?
    let revokedAt: String?

    var isRevoked: Bool { revokedAt != nil }
}

// MARK: - Settings

/// `GET /api/v1/users/me`. `role` is what gates the admin screens.
struct SottoAccount: Decodable, Equatable {
    let id: String
    let name: String?
    let email: String?
    let image: String?
    let role: String?
    let preferredLanguage: String?
    let preferredAiModel: String?
    let preferredTtsModel: String?
    let preferredSttModel: String?
    let showAgentUsageStatus: Bool?

    var isAdmin: Bool { role == "ADMIN" }
}

/// PATCH body for `users/me`. The route's schema is strict, and Swift omits
/// nil optionals when encoding, so each save sends only what changed.
struct SottoAccountUpdate: Encodable, Equatable {
    var name: String?
    var image: String?
    var preferredLanguage: String?
    var preferredAiModel: String?
    var showAgentUsageStatus: Bool?
}

struct SottoAiModelList: Decodable, Equatable {
    let provider: String?
    let isByok: Bool?
    let models: [SottoAiModel]
}

struct SottoAiModel: Decodable, Identifiable, Equatable {
    let id: String
    let displayName: String
    let tier: String?
    let isDefault: Bool?
    let group: String?
}

struct SottoAvatarUploadResponse: Decodable, Equatable {
    let image: String?
    let url: String?

    var resolvedImage: String? { image ?? url }
}
