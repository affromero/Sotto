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
    let activeClassId: String?
    let curriculum: SottoCurriculum?
}

struct SottoCurriculum: Decodable, Equatable {
    let title: String?
}

struct NextClassCreatedResponse: Decodable {
    let classId: String?
    let activeClassId: String?
    let done: Bool?
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

struct SottoClassDetail: Decodable, Identifiable, Equatable {
    let id: String
    let courseId: String
    let status: String
    let order: Int
    let passThreshold: Double
    let sourceUrl: String?
    let sourceTitle: String?
    let lesson: SottoLesson?
    let submitted: Bool
    let sections: [SottoClassSection]
}

struct SottoLesson: Decodable, Equatable {
    let title: String
    let level: String
    let objective: String?
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

struct SottoClassEpisode: Decodable, Equatable {
    let id: String
    let audioUrl: String?
    let title: String
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
}

struct SottoWritingPrompt: Decodable, Identifiable, Equatable {
    let id: String
    let order: Int?
    let task: String
    let guidance: String?
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
