import SwiftUI

/// One writer per open session. Revisions prevent a stale device from overwriting saved work.
@MainActor
final class LearningProgressStore: ObservableObject {
    @Published private(set) var errorMessage: String?
    private var revision = 0
    private var client: SottoAPIClient?
    private var path = ""
    private(set) var answers: [String: Int]?
    private var pending: LearningProgressRequest?
    private var saving = false
    private var paused = false
    private var suspended = false
    var isSuspended: Bool { suspended }
    private var discarded = false
    private var drainWaiters: [CheckedContinuation<Void, Never>] = []
    private var reconciliationRevision: Int?
    private var classAttempt: Int?
    private var classMaterialRevision: String?
    private var changes = 0
    var recoveryGeneration: Int { changes }
    private var isCurrent: @MainActor () -> Bool = { true }

    var recoverableText: String? {
        guard let work = pending else { return nil }
        let choices = work.answers.sorted { $0.key < $1.key }.map { "Question \($0.key): option \($0.value + 1)" }
        let drafts = work.writingDrafts.sorted { $0.key < $1.key }.map { "Writing \($0.key):\n\($0.value)" }
        let text = (choices + drafts).joined(separator: "\n\n")
        return text.isEmpty ? nil : text
    }

    func configure(client: SottoAPIClient?, path: String, revision: Int, attempt: Int? = nil, materialRevision: String? = nil, isCurrent: @escaping @MainActor () -> Bool = { true }) {
        if let existing = self.client {
            guard let client, existing.serverURL == client.serverURL, existing.profileId == client.profileId,
                  self.path == path, !saving, !discarded else { return }
            if SottoLearnerIdentity(existing) != SottoLearnerIdentity(client) {
                guard pending == nil || (classAttempt != nil && classMaterialRevision != nil) else {
                    paused = true
                    errorMessage = "Your connection changed. Keep or copy these edits before reopening the session."
                    return
                }
                self.client = client
                self.isCurrent = isCurrent
                changes += 1
                reconciliationRevision = nil
                if pending != nil {
                    paused = true
                    errorMessage = "Your connection changed. Your edits are kept on this screen. Check saved progress before continuing."
                }
            }
            guard (classAttempt == nil || classAttempt == attempt), classMaterialRevision == nil,
                  pending == nil, answers == nil, !saving, attempt != nil, materialRevision != nil else { return }
            self.revision = revision
            self.classAttempt = attempt
            self.classMaterialRevision = materialRevision
            self.isCurrent = isCurrent
            return
        }
        self.client = client
        self.path = path
        self.revision = revision
        self.classAttempt = attempt
        self.classMaterialRevision = materialRevision
        self.isCurrent = isCurrent
    }

    func update(answers: [String: Int], writingDrafts: [String: String]) {
        guard !discarded else { return }
        changes += 1
        reconciliationRevision = nil
        self.answers = answers
        pending = LearningProgressRequest(expectedRevision: revision, answers: answers, writingDrafts: writingDrafts)
        Task { await flush() }
    }

    func flush() async {
        guard !saving, !paused, !suspended, !discarded, let client else { return }
        saving = true
        defer {
            saving = false
            let waiters = drainWaiters
            drainWaiters.removeAll()
            for waiter in waiters { waiter.resume() }
        }
        while !suspended, let next = pending {
            pending = nil
            do {
                guard isCurrent() else { throw CancellationError() }
                if path.hasPrefix("/api/v1/classes/") && (classAttempt == nil || classMaterialRevision == nil) {
                    throw SottoAPIError.message("The class material cannot be verified. Keep your edits and reopen the class.")
                }
                let result = try await client.saveLearningProgress(path: path, expectedRevision: revision,
                    answers: next.answers, writingDrafts: next.writingDrafts,
                    expectedAttempt: classAttempt, taskMaterialRevision: classMaterialRevision)
                guard isCurrent() else { throw CancellationError() }
                revision = result.progressRevision
                errorMessage = nil
            } catch {
                if pending == nil { pending = next }
                paused = true
                errorMessage = "Your edits are kept on this screen. Saving failed: \(error.localizedDescription). Reopen the session to check saved work."
                return
            }
        }
    }

    func flushRevision() async throws -> Int {
        while saving { await withCheckedContinuation { drainWaiters.append($0) } }
        await flush()
        if let errorMessage { throw SottoAPIError.message(errorMessage) }
        guard pending == nil else { throw SottoAPIError.message("Your changes have not been saved yet.") }
        return revision
    }

    func acceptRevision(_ value: Int) {
        revision = value
    }

    func replacePendingWithServerRevision(_ value: Int) {
        guard suspended, !saving, !discarded else { return }
        pending = nil
        revision = value
        paused = false
        errorMessage = nil
        suspended = false
    }

    func suspend() async {
        suspended = true
        changes += 1
        reconciliationRevision = nil
        if saving { await withCheckedContinuation { drainWaiters.append($0) } }
    }

    func resume() {
        guard !discarded else { return }
        suspended = false
        Task { await flush() }
    }

    func resumeWithoutSaving() {
        guard !discarded else { return }
        suspended = false
        if pending != nil { paused = true }
    }

    func discard() {
        changes += 1
        reconciliationRevision = nil
        discarded = true
        suspended = true
        pending = nil
        client = nil
        errorMessage = nil
    }

    func prepareReconciliation() async throws {
        guard !saving, !discarded, !suspended, isCurrent(), let client else { throw SottoAPIError.message("Wait for the active save to finish.") }
        changes += 1
        reconciliationRevision = nil
        let originalChanges = changes
        let originalPath = path
        let id = String(path.split(separator: "/").last ?? "")
        let latest: Int
        if path.hasPrefix("/api/v1/classes/") {
            guard let classAttempt, let classMaterialRevision else {
                throw SottoAPIError.message("The class material cannot be verified. Keep your edits and reopen the class.")
            }
            let current = try await client.fetchClassProgressRecovery(classId: id)
            guard current.classId == id, current.attempt == classAttempt,
                  current.progressRevision >= 0,
                  current.taskMaterialRevision == classMaterialRevision,
                  ["AVAILABLE", "IN_PROGRESS"].contains(current.status) else {
                throw SottoAPIError.message("The class material changed. Keep your edits and reopen the class.")
            }
            latest = current.progressRevision
        } else {
            latest = try await client.fetchPractice(sessionId: id).progressRevision ?? 0
        }
        guard !discarded, !suspended, isCurrent(), changes == originalChanges, path == originalPath else { throw CancellationError() }
        reconciliationRevision = latest
    }

    func confirmReconciliation() {
        guard !discarded, !suspended, isCurrent(), let latest = reconciliationRevision else { return }
        revision = latest
        reconciliationRevision = nil
        paused = false
        Task { await flush() }
    }

    func retry() {
        changes += 1
        reconciliationRevision = nil
        paused = false
        Task { await flush() }
    }
}
