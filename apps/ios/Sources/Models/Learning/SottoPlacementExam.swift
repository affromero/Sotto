import Foundation

// MARK: - Placement

struct SottoPlacementAnswer: Encodable, Equatable {
    let id: String
    /// 0-3 pick an option; 4 is the "I don't know" answer the scorer expects.
    let selectedIndex: Int

    static let dontKnowIndex = 4
}

struct SottoPlacementResult: Decodable, Equatable {
    let courseId: String
    let level: String
    let assessedLevel: String
    let confirmationReceiptId: UUID
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
    let code: String?
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
