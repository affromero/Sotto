import Foundation

struct ClassAssessmentWork: Codable, Equatable {
    var choices: [String: Int] = [:]
    var drafts: [String: String] = [:]
    var pending: [SottoPracticeAnswer]?
    var rejected: Bool? = nil
}

/// Keep assessment work scoped to the learner, class, attempt and material revision.
@MainActor
struct ClassAssessmentWorkStore {
    private let storage: VocabularyPendingStore
    let assessmentId: String
    let revision: String

    private static func prefix(classId: String, classAttempt: Int) -> String {
        "assessment/\(classId.utf8.count):\(classId)/\(classAttempt)/"
    }

    init(client: SottoAPIClient, classId: String, classAttempt: Int, assessmentId: String, revision: String) {
        self.assessmentId = assessmentId
        self.revision = revision
        let encoded = Data(assessmentId.utf8).base64EncodedString()
        let scope = Self.prefix(classId: classId, classAttempt: classAttempt) + "\(encoded).\(revision)"
        storage = VocabularyPendingStore(client: client, scope: scope)
    }

    static func pending(client: SottoAPIClient, classId: String, classAttempt: Int) throws -> [ClassAssessmentWorkStore] {
        let prefix = prefix(classId: classId, classAttempt: classAttempt)
        let index = VocabularyPendingStore(client: client, scope: prefix)
        return try index.ownedScopes(prefix: prefix).compactMap { scope in
            let parts = scope.dropFirst(prefix.count).split(separator: ".", omittingEmptySubsequences: false)
            guard parts.count == 2, let data = Data(base64Encoded: String(parts[0])),
                  let assessmentId = String(data: data, encoding: .utf8), !assessmentId.isEmpty else {
                throw SottoAPIError.message("Saved assessment work could not be read.")
            }
            let revision = String(parts[1])
            guard revision.count == 64, revision.allSatisfy({ "0123456789abcdef".contains($0) }) else {
                throw SottoAPIError.message("Saved assessment work could not be read.")
            }
            let store = ClassAssessmentWorkStore(client: client, classId: classId, classAttempt: classAttempt,
                                                 assessmentId: assessmentId, revision: revision)
            return try store.load().pending == nil ? nil : store
        }
    }

    func load() throws -> ClassAssessmentWork {
        try storage.load(ClassAssessmentWork.self) ?? ClassAssessmentWork()
    }

    func saveDrafts(choices: [String: Int], drafts: [String: String]) throws {
        let previous = try load()
        guard previous.pending == nil else {
            throw SottoAPIError.message("Check the saved assessment submission before changing answers.")
        }
        try storage.replace(ClassAssessmentWork(choices: choices, drafts: drafts, pending: nil))
    }

    /// Retain the exact request before sending it, so an uncertain response can be replayed.
    func lockSubmission() throws -> [SottoPracticeAnswer] {
        var work = try load()
        if let pending = work.pending { return pending }
        let pending = work.choices.keys.sorted().map {
            SottoPracticeAnswer(itemId: $0, selectedIndex: work.choices[$0]!)
        }
        work.pending = pending
        work.rejected = false
        try storage.replace(work)
        return pending
    }

    func markRejected(choices: [SottoPracticeAnswer]) throws {
        var work = try load()
        guard work.pending == choices else {
            throw SottoAPIError.message("The saved assessment submission changed.")
        }
        work.rejected = true
        try storage.replace(work)
    }

    /// The caller must first verify the owned class and unchanged unsubmitted assessment.
    func unlockRejected(choices: [SottoPracticeAnswer]) throws {
        var work = try load()
        guard work.rejected == true, work.pending == choices else {
            throw SottoAPIError.message("The saved assessment submission could not be verified.")
        }
        work.pending = nil
        work.rejected = nil
        try storage.replace(work)
    }

    /// Call after the exact retained request and writing drafts have been confirmed by the server.
    func clearConfirmed(choices: [SottoPracticeAnswer], receipt: SottoClassSubmitResult,
                        confirmedWriting: [String: String]) throws {
        let work = try load()
        guard receipt.source == "ASSESSMENT", work.pending == choices,
              work.drafts.allSatisfy({ $0.value.isEmpty || confirmedWriting[$0.key] == $0.value }) else {
            throw SottoAPIError.message("The saved assessment submission could not be verified.")
        }
        try storage.clear()
    }
}
