import Foundation

enum SottoClassPrerequisiteStatus: String, Decodable {
    case available = "AVAILABLE"
    case unavailable = "UNAVAILABLE"
    case pending = "PENDING"
    case unresolved = "UNRESOLVED"
    case ready = "READY"
    case failed = "FAILED"
    case stale = "STALE"
}

struct SottoClassPrerequisiteRequest: Codable, Equatable {
    let sourceHash: String
    let snapshotHash: String
}

struct SottoClassPrerequisiteAcknowledgment: Encodable, Equatable {
    let sourceHash: String
    let receiptId: String
}

enum SottoPrerequisiteTaskKind: String, Decodable, Hashable {
    case question, speaking, writing
}

struct SottoPrerequisiteTaskDirection: Decodable, Equatable {
    let sectionId: String
    let taskId: String
    let kind: SottoPrerequisiteTaskKind
    let instruction: String
}

struct SottoPrerequisiteDirections: Decodable, Equatable {
    let guided: String
    let tasks: [SottoPrerequisiteTaskDirection]

    func instruction(sectionId: String, taskId: String, kind: SottoPrerequisiteTaskKind) -> String? {
        tasks.first { $0.sectionId == sectionId && $0.taskId == taskId && $0.kind == kind }?.instruction
    }
}

struct SottoClassPrerequisiteContent: Decodable, Equatable {
    struct Example: Decodable, Equatable {
        let target: String
        let meaning: String
        let explanation: String
    }
    let title: String
    let explanation: String
    let examples: [Example]
    let directions: SottoPrerequisiteDirections
}

struct SottoClassPrerequisiteResponse: Decodable, Equatable {
    let status: SottoClassPrerequisiteStatus
    let request: SottoClassPrerequisiteRequest
    let nativeLang: String
    let targetLang: String
    let content: SottoClassPrerequisiteContent?
    let canRetry: Bool?
    let recoverable: Bool?
    let failure: String?
    let receiptId: String?
    let acknowledged: Bool?

    private struct TaskKey: Hashable {
        let sectionId: String
        let taskId: String
        let kind: SottoPrerequisiteTaskKind
    }

    func validateAcknowledgment(_ request: SottoClassPrerequisiteAcknowledgment, for detail: SottoClassDetail) throws {
        try validate(for: detail)
        guard status == .ready, acknowledged == true, self.request.sourceHash == request.sourceHash,
              receiptId == request.receiptId else {
            throw SottoAPIError.message("The explanation changed. Check the saved status.")
        }
    }

    func validate(for detail: SottoClassDetail) throws {
        let invalid = SottoAPIError.message("The saved prerequisite explanation does not match this class.")
        func digest(_ value: String) -> Bool {
            value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
        func text(_ value: String, max: Int) -> Bool {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && value.utf16.count <= max
        }
        guard let expected = detail.prerequisiteSourceHash, digest(expected),
              digest(request.sourceHash), digest(request.snapshotHash) else { throw invalid }
        guard request.sourceHash == expected else {
            throw SottoAPIError.message("The class changed. Reopen the class before viewing this explanation.")
        }
        guard
              nativeLang.utf8.count == 2, targetLang.utf8.count == 2,
              nativeLang.utf8.allSatisfy({ (97...122).contains($0) }),
              targetLang.utf8.allSatisfy({ (97...122).contains($0) }),
              (status == .ready) == (content != nil),
              (status == .ready) == (receiptId != nil),
              (status == .ready) == (acknowledged != nil),
              receiptId.map({ UUID(uuidString: $0) != nil }) ?? true,
              ([.failed, .stale].contains(status)) == (canRetry != nil),
              recoverable == nil || status == .pending,
              failure == nil || (status == .failed && failure == "UNSAFE") else { throw invalid }
        guard let content else { return }
        guard text(content.title, max: 240), text(content.explanation, max: 8000),
              (1...8).contains(content.examples.count), text(content.directions.guided, max: 1000),
              content.examples.allSatisfy({ text($0.target, max: 1000) && text($0.meaning, max: 1000) && text($0.explanation, max: 2000) }) else { throw invalid }
        var expectedTasks = Set<TaskKey>()
        for section in detail.sections {
            let entries: [(String, SottoPrerequisiteTaskKind)] =
                section.questions.map { ($0.id, .question) } +
                section.prompts.map { ($0.id, .speaking) } +
                section.writingPrompts.map { ($0.id, .writing) }
            for (id, kind) in entries {
                guard !id.isEmpty, expectedTasks.insert(TaskKey(sectionId: section.id, taskId: id, kind: kind)).inserted else { throw invalid }
            }
        }
        guard (1...100).contains(expectedTasks.count), content.directions.tasks.count == expectedTasks.count else { throw invalid }
        var actualTasks = Set<TaskKey>()
        for item in content.directions.tasks {
            let key = TaskKey(sectionId: item.sectionId, taskId: item.taskId, kind: item.kind)
            guard text(item.instruction, max: 1000), expectedTasks.contains(key), actualTasks.insert(key).inserted else { throw invalid }
        }
        guard expectedTasks == actualTasks else { throw invalid }
    }
}
