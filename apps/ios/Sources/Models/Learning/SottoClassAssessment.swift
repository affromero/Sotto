import Foundation

struct SottoClassAssessmentStatus: Decodable, Equatable {
    enum State: String, Decodable {
        case practiceRequired = "PRACTICE_REQUIRED"
        case unresolved = "UNRESOLVED"
        case available = "AVAILABLE"
        case pending = "PENDING"
        case ready = "READY"
    }

    let status: State
    let classAttempt: Int
    let revision: String?
    let assessmentId: String?

    func validate(expectedAttempt: Int) throws {
        guard classAttempt == expectedAttempt, classAttempt > 0 else {
            throw SottoAPIError.message("The class changed. Return to the lesson.")
        }
        let needsRevision = [.available, .pending, .ready].contains(status)
        guard needsRevision == (revision != nil),
              revision.map({ $0.count == 64 && $0.allSatisfy { "0123456789abcdef".contains($0) } }) ?? true,
              (status == .ready) == (assessmentId?.isEmpty == false) else {
            throw SottoAPIError.message("The assessment status could not be verified.")
        }
    }

    func validateUnlock(classDetail: SottoClassDetail, classId: String, attempt: Int,
                        assessmentId expectedAssessmentId: String, revision expectedRevision: String) throws {
        try validate(expectedAttempt: attempt)
        guard classDetail.id == classId, classDetail.attempt == attempt, !classDetail.submitted,
              status == .ready, assessmentId == expectedAssessmentId, revision == expectedRevision else {
            throw SottoAPIError.message("The assessment changed. Check its saved status.")
        }
    }
}

struct SottoClassAssessmentMaterial: Decodable, Equatable {
    struct Section: Decodable, Equatable, Identifiable {
        struct Item: Decodable, Equatable, Identifiable {
            let id: String
            let question: String?
            let options: [String]?
            let task: String?
            let mode: String?
            let referenceAudioAvailable: Bool?
        }
        let id: String
        let skill: String
        let passageText: String?
        let audioAvailable: Bool?
        let items: [Item]
    }

    let id: String
    let classAttempt: Int
    let assessmentAttempt: Int
    let sections: [Section]

    func speakingIsComplete(_ responses: [String: SottoClassAssessmentSpeakingStatus]) -> Bool {
        sections.filter { $0.skill == "SPEAKING" }.allSatisfy { section in
            section.items.allSatisfy { responses[$0.id]?.status == .completed }
        }
    }

    func validate(assessmentId: String, classAttempt expectedAttempt: Int) throws {
        guard id == assessmentId, classAttempt == expectedAttempt, assessmentAttempt > 0,
              !sections.isEmpty, sections.count <= 5,
              Set(sections.map(\.id)).count == sections.count,
              Set(sections.map(\.skill)).count == sections.count else {
            throw SottoAPIError.message("The assessment changed. Check its status again.")
        }
        var itemIds = Set<String>()
        for section in sections {
            guard !section.id.isEmpty, !section.items.isEmpty, section.items.count <= 20 else {
                throw SottoAPIError.message("The assessment material could not be verified.")
            }
            for item in section.items {
                guard !item.id.isEmpty, itemIds.insert(item.id).inserted else {
                    throw SottoAPIError.message("The assessment material could not be verified.")
                }
                switch section.skill {
                case "GRAMMAR", "READING", "LISTENING":
                    guard item.question?.isEmpty == false, item.options?.count == 4,
                          item.options?.allSatisfy({ !$0.isEmpty }) == true,
                          section.audioAvailable != nil else {
                        throw SottoAPIError.message("The assessment material could not be verified.")
                    }
                case "WRITING":
                    guard item.task?.isEmpty == false else {
                        throw SottoAPIError.message("The assessment material could not be verified.")
                    }
                case "SPEAKING":
                    guard item.task?.isEmpty == false,
                          ["READ_ALOUD", "COMMUNICATIVE"].contains(item.mode ?? ""),
                          item.referenceAudioAvailable != nil else {
                        throw SottoAPIError.message("The assessment material could not be verified.")
                    }
                default:
                    throw SottoAPIError.message("The assessment material could not be verified.")
                }
            }
        }
    }
}

struct SottoClassAssessmentWritingStatus: Decodable, Equatable {
    enum State: String, Decodable {
        case notStarted = "NOT_STARTED"
        case running = "RUNNING"
        case unresolved = "UNRESOLVED"
        case completed = "COMPLETED"
        case failed = "FAILED"
    }
    let status: State
    let text: String?

    func validate() throws {
        guard (status == .notStarted) == (text == nil), (text?.count ?? 0) <= 100_000 else {
            throw SottoAPIError.message("The saved writing response could not be verified.")
        }
    }
}

struct SottoClassAssessmentSpeakingStatus: Decodable, Equatable {
    enum State: String, Decodable {
        case notStarted = "NOT_STARTED"
        case running = "RUNNING"
        case unresolved = "UNRESOLVED"
        case completed = "COMPLETED"
        case failed = "FAILED"
    }
    let status: State
    let requestId: String?

    func validate() throws {
        guard (status == .notStarted) == (requestId == nil),
              requestId.map({ UUID(uuidString: $0) != nil }) ?? true else {
            throw SottoAPIError.message("The saved speaking response could not be verified.")
        }
    }
}
