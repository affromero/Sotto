import Foundation

enum SottoClassLessonHelpStatus: String, Decodable {
    case available = "AVAILABLE"
    case pending = "PENDING"
    case ready = "READY"
    case failed = "FAILED"
}

struct SottoClassLessonHelpRequest: Codable, Equatable {
    let operationId: String
    let attempt: Int
    let sourceHash: String
    let retryOf: String?

    enum CodingKeys: String, CodingKey { case operationId, attempt, sourceHash, retryOf }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        operationId = try container.decode(String.self, forKey: .operationId)
        attempt = try container.decode(Int.self, forKey: .attempt)
        sourceHash = try container.decode(String.self, forKey: .sourceHash)
        retryOf = try container.decode(String?.self, forKey: .retryOf)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(operationId, forKey: .operationId)
        try container.encode(attempt, forKey: .attempt)
        try container.encode(sourceHash, forKey: .sourceHash)
        try container.encode(retryOf, forKey: .retryOf)
    }
}

struct SottoClassLessonHelp: Decodable {
    struct WorkedExample: Decodable {
        let prompt: String
        let meaning: String
        let explanation: String
    }

    let title: String
    let explanation: String
    let workedExamples: [WorkedExample]
    let correctionExplanation: String
    let guidedPrompt: String
    let guidedHint: String
}

struct SottoClassLessonHelpResponse: Decodable {
    let status: SottoClassLessonHelpStatus
    let request: SottoClassLessonHelpRequest
    let nativeLang: String
    let targetLang: String
    let canRetry: Bool
    let help: SottoClassLessonHelp?
    private let errorMessage: String?
    var error: String? {
        errorMessage.map { SottoClassLessonHelpFailure.normalizedMessage($0) ?? $0 }
    }

    enum CodingKeys: String, CodingKey {
        case status, request, nativeLang, targetLang, canRetry, help
        case errorMessage = "error"
    }

    func validate(for teaching: SottoClassTeaching) throws {
        guard request.sourceHash == teaching.sourceHash else {
            throw SottoAPIError.message("The saved lesson changed. Reopen the class before requesting help.")
        }
        guard request.attempt > 0, UUID(uuidString: request.operationId) != nil,
              request.retryOf == nil || UUID(uuidString: request.retryOf ?? "") != nil,
              !nativeLang.isEmpty, !targetLang.isEmpty else {
            throw SottoAPIError.message("Language help returned an incomplete response. Check its saved status.")
        }
        if status == .ready {
            guard let help, (2...3).contains(help.workedExamples.count),
                  help.workedExamples.count == teaching.workedExamples.count else {
                throw SottoAPIError.message("The saved help does not match this lesson.")
            }
            let entries = [help.title, help.explanation, help.correctionExplanation,
                           help.guidedPrompt, help.guidedHint] + help.workedExamples.flatMap {
                [$0.prompt, $0.meaning, $0.explanation]
            }
            guard entries.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                throw SottoAPIError.message("Language help returned an incomplete response. Check its saved status.")
            }
        }
        if status == .failed && (error?.isEmpty ?? true) {
            throw SottoAPIError.message("Language help returned an incomplete response. Check its saved status.")
        }
    }
}
