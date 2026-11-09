import Foundation

enum SottoClassPreludeKind: String, Decodable {
    case notRequired = "NOT_REQUIRED"
    case replay = "REPLAY"
    case generating = "GENERATING"
    case unavailable = "UNAVAILABLE"
    case base = "BASE"
    case addendum = "ADDENDUM"
}

struct SottoClassPreludeTeaching: Decodable, Equatable {
    let version: Int
    let title: String
    let explanation: String
    let workedExamples: [SottoWorkedExample]
    let commonMistake: SottoCommonMistake
}

struct SottoClassPreludeContent: Decodable, Equatable {
    let title: String
    let explanation: String
    let examples: [SottoClassPrerequisiteContent.Example]
}

struct SottoClassPrelude: Decodable, Equatable {
    let kind: SottoClassPreludeKind
    let nativeLang: String?
    let targetLang: String?
    let receiptId: String?
    let acknowledged: Bool?
    let teaching: SottoClassPreludeTeaching?
    let request: SottoClassPrerequisiteRequest?
    let status: SottoClassPrerequisiteStatus?
    let content: SottoClassPreludeContent?
    let canRetry: Bool?
    let recoverable: Bool?
    let failure: String?

    func validate() throws {
        let invalid = SottoAPIError.message("The prerequisite teaching response is incomplete. Check saved status.")
        let commonEmpty = nativeLang == nil && targetLang == nil && receiptId == nil && acknowledged == nil &&
            teaching == nil && request == nil && status == nil && content == nil && canRetry == nil &&
            recoverable == nil && failure == nil
        if [.notRequired, .replay, .generating, .unavailable].contains(kind) {
            guard commonEmpty else { throw invalid }
            return
        }
        func language(_ value: String?) -> Bool {
            guard let value else { return false }
            return value.utf8.count == 2 && value.utf8.allSatisfy { (97...122).contains($0) }
        }
        func digest(_ value: String) -> Bool {
            value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
        func text(_ value: String, max: Int) -> Bool {
            !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf16.count <= max
        }
        guard language(nativeLang), language(targetLang) else { throw invalid }
        if kind == .base {
            guard let teaching, teaching.version == 1, text(teaching.title, max: 160),
                  text(teaching.explanation, max: 1800), (2...3).contains(teaching.workedExamples.count),
                  teaching.workedExamples.allSatisfy({
                      text($0.prompt, max: 800) && text($0.answer, max: 800) && text($0.explanation, max: 1800)
                  }), text(teaching.commonMistake.incorrect, max: 800),
                  text(teaching.commonMistake.correction, max: 800),
                  text(teaching.commonMistake.explanation, max: 1800),
                  let receiptId, UUID(uuidString: receiptId) != nil, acknowledged != nil,
                  request == nil, status == nil, content == nil, canRetry == nil,
                  recoverable == nil, failure == nil else { throw invalid }
            return
        }
        guard kind == .addendum, teaching == nil, let request,
              digest(request.sourceHash), digest(request.snapshotHash), let status else { throw invalid }
        let ready = status == .ready
        guard ready == (content != nil), ready == (receiptId != nil), ready == (acknowledged != nil),
              receiptId.map({ UUID(uuidString: $0) != nil }) ?? true,
              ([.failed, .stale].contains(status)) == (canRetry != nil),
              recoverable == nil || status == .pending,
              failure == nil || (status == .failed && failure == "UNSAFE") else { throw invalid }
        if let content {
            guard text(content.title, max: 240), text(content.explanation, max: 8000),
                  (1...8).contains(content.examples.count), content.examples.allSatisfy({
                      text($0.target, max: 1000) && text($0.meaning, max: 1000) && text($0.explanation, max: 2000)
                  }) else { throw invalid }
        }
    }
}

struct SottoClassPreludeAcknowledgment: Codable, Equatable {
    let kind: String
    let receiptId: String
}

struct SottoClassPreludeAcknowledgmentResponse: Decodable {
    let kind: String
    let receiptId: String
    let acknowledged: Bool

    func validate(for expected: SottoClassPreludeAcknowledgment) throws {
        guard kind == expected.kind, receiptId == expected.receiptId, acknowledged else {
            throw SottoAPIError.message("The lesson changed. Check saved status.")
        }
    }
}
