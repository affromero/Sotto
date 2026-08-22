import Foundation

struct SottoCredentials: Codable, Equatable {
    let serverURL: URL
    let apiKey: String
    let user: SottoUser?
    let selectedProfile: SottoProfile?
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
    let activeClassId: String?
    let curriculum: SottoCurriculum?
    let classes: [SottoCourseClassSummary]

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
}

struct SottoSpeakingRecording: Decodable, Equatable {
    let id: String
    let status: String
    let transcript: String?
    let overallScore: Double?
    let rubricScores: [String: Double]?
    let phonemeScores: [SottoSpeakingAlignmentToken]?
    let feedback: String?
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

    var latestResponse: SottoWritingResponse? { responses?.first }
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

/// What is due for review on a course, and the sessions already started.
/// The same payload the web practice panel reads.
struct SottoPracticeOverview: Decodable, Equatable {
    struct Due: Decodable, Equatable {
        let vocab: Int
        let grammar: Int
    }

    let due: Due
    let totalVocab: Int
    let recent: [SottoPracticeSessionSummary]

    var totalDue: Int { due.vocab + due.grammar }

    /// Sessions that were started and never finished, newest first.
    var unfinished: [SottoPracticeSessionSummary] {
        recent.filter { $0.completedAt == nil }
    }
}

struct SottoPracticeSessionSummary: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let status: String
    let score: Double?
    let startedAt: String?
    let completedAt: String?
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
}

struct SottoPracticeItem: Decodable, Identifiable, Equatable {
    let id: String
    let prompt: String
    let options: [String]
}

struct SottoSubmitAnswer: Encodable, Equatable {
    let questionId: String
    let selectedIndex: Int
}

struct SottoPracticeAnswer: Encodable, Equatable {
    let itemId: String
    let selectedIndex: Int
}

struct SottoClassSubmitResult: Decodable, Equatable {
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

struct SottoClassSectionResult: Decodable, Identifiable, Equatable {
    let id: String
    let skill: String
    let score: Double
    let passed: Bool
}

struct SottoPracticeSubmitResult: Decodable, Equatable {
    let score: Double
    let correct: Int
    let total: Int
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

// MARK: - Activity

/// `GET /api/v1/learn/activity`: one year of study days, bucketed in the learner's
/// timezone by the server, plus streaks.
struct SottoActivity: Decodable, Equatable {
    let timeZone: String
    let todayIso: String
    /// ISO local day (YYYY-MM-DD) -> per-category counts. Quiet days are absent.
    let days: [String: [String: Int]]
    let currentStreak: Int
    let longestStreak: Int

    func total(on day: String) -> Int {
        days[day]?.values.reduce(0, +) ?? 0
    }

    /// The category a day is coloured by: whichever the learner did most of,
    /// ties broken by name so the colour does not flicker between loads.
    func dominantCategory(on day: String) -> String? {
        guard let counts = days[day], !counts.isEmpty else { return nil }
        return counts.max { lhs, rhs in
            lhs.value == rhs.value ? lhs.key > rhs.key : lhs.value < rhs.value
        }?.key
    }
}

// MARK: - Memory graph

/// `GET /api/v1/courses/{id}/graph`: every word and grammar point the learner
/// has met on this course, with its spaced-repetition state.
struct SottoMemoryGraph: Decodable, Equatable {
    let nodes: [SottoMemoryNode]

    var dueNodes: [SottoMemoryNode] { nodes.filter(\.due) }

    /// Weak-first, so the list opens on what needs work.
    var byStrength: [SottoMemoryNode] {
        nodes.sorted { $0.strength < $1.strength }
    }
}

struct SottoMemoryNode: Decodable, Identifiable, Equatable {
    let id: String
    let kind: String
    let label: String
    let translation: String?
    let strength: Double
    let due: Bool
    let cefrLevel: String?
    let reviewCount: Int
    let lapseCount: Int
    let partOfSpeech: String?
    let pronunciation: String?
    let topicKey: String?

    var isVocab: Bool { kind == "vocab" }
}

// MARK: - Placement

struct SottoPlacementBatch: Decodable, Equatable {
    let native: String
    let target: String
    let questions: [SottoPlacementQuestion]
}

struct SottoPlacementQuestion: Decodable, Identifiable, Equatable {
    let id: String
    let cefr: String
    let skill: String
    let prompt: String
    let options: [String]
}

struct SottoPlacementAnswer: Encodable, Equatable {
    let id: String
    /// 0-3 pick an option; 4 is the "I don't know" answer the scorer expects.
    let selectedIndex: Int

    static let dontKnowIndex = 4
}

struct SottoPlacementResult: Decodable, Equatable {
    let courseId: String
    let level: String
    let scoreBySkill: [String: Double]?
}

struct SottoManualPlacementResult: Decodable, Equatable {
    let courseId: String
    let level: String
}

// MARK: - Mock exams

/// `GET /api/v1/courses/{id}/exams`: the exam this course can sit, plus the
/// learner's past attempts.
struct SottoCourseExams: Decodable, Equatable {
    let available: SottoExamAvailable
    let history: [SottoExamHistoryEntry]
}

struct SottoExamAvailable: Decodable, Equatable {
    let institution: String
    let institutionLabel: String
    let examName: String
    let level: String
    let sectionCount: Int
}

struct SottoExamHistoryEntry: Decodable, Identifiable, Equatable {
    let id: String
    let examName: String
    let level: String
    let status: String
    let band: String?
    let overallScore: Double?
    let createdAt: String
}

struct SottoExamDetail: Decodable, Identifiable, Equatable {
    let id: String
    let institution: String
    let institutionLabel: String
    let level: String
    let status: String
    let examName: String
    let sections: [SottoExamSection]
    let result: SottoExamResult?

    var isScored: Bool { status == "SCORED" }

    /// Sections are generated one per skill and each can fail on its own. When
    /// every one failed the server still hands back a 201 and an exam id, so
    /// the runner has to recognise the empty shell itself.
    var allSectionsFailed: Bool {
        !sections.isEmpty && sections.allSatisfy { $0.status == "FAILED" }
    }
}

struct SottoExamSection: Decodable, Identifiable, Equatable {
    let id: String
    let skill: String
    let part: String
    let order: Int
    let format: String
    let weight: Double
    let status: String
    let score: Double?
    let episode: SottoExamEpisode?
    let questions: [SottoExamQuestion]
    let speakingPrompts: [SottoSpeakingPrompt]
    let writingPrompts: [SottoWritingPrompt]
}

struct SottoExamEpisode: Decodable, Equatable {
    let id: String
    let audioUrl: String?
    let status: String
}

struct SottoExamQuestion: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int
    let question: String
    let options: [String]
    let passageRef: String?
    let passageText: String?
    /// Present only once the exam is scored.
    let correctIndex: Int?
    let explanation: String?
}

struct SottoExamResult: Decodable, Equatable {
    let overallScore: Double?
    let band: String?
    let feedback: String?
    let sectionResults: [SottoExamSectionResult]
}

struct SottoExamSectionResult: Decodable, Identifiable, Equatable {
    let sectionId: String
    let skill: String
    let score: Double
    let feedback: String?

    var id: String { sectionId }
}

struct SottoExamStartResponse: Decodable {
    let examId: String
}

/// `POST /api/v1/exams/{id}/submit` answers with the score, not the exam, so
/// the runner refetches the exam afterwards for the answer key.
struct SottoExamScoreResult: Decodable, Equatable {
    let overallScore: Double
    let band: String
    let feedback: String
    let sections: [SottoExamSectionScore]
}

struct SottoExamSectionScore: Decodable, Identifiable, Equatable {
    let sectionId: String
    let skill: String
    let weight: Double
    let score: Double

    var id: String { sectionId }
}

struct SottoErrorResponse: Decodable {
    let error: FlexibleError
}

enum FlexibleError: Decodable, CustomStringConvertible {
    case text(String)
    case object

    var description: String {
        switch self {
        case let .text(value):
            value
        case .object:
            "The Sotto server rejected this request."
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            self = .text(text)
        } else {
            self = .object
        }
    }
}
