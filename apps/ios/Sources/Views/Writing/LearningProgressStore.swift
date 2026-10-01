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
    private var reconciliationRevision: Int?

    func configure(client: SottoAPIClient?, path: String, revision: Int) {
        guard self.client == nil else { return }
        self.client = client
        self.path = path
        self.revision = revision
    }

    func update(answers: [String: Int], writingDrafts: [String: String]) {
        self.answers = answers
        pending = LearningProgressRequest(expectedRevision: revision, answers: answers, writingDrafts: writingDrafts)
        Task { await flush() }
    }

    func flush() async {
        guard !saving, !paused, let client else { return }
        saving = true
        defer { saving = false }
        while let next = pending {
            pending = nil
            do {
                let result = try await client.saveLearningProgress(path: path, expectedRevision: revision,
                    answers: next.answers, writingDrafts: next.writingDrafts)
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

    func prepareReconciliation() async throws {
        guard !saving, let client else { throw SottoAPIError.message("Wait for the active save to finish.") }
        let id = String(path.split(separator: "/").last ?? "")
        if path.hasPrefix("/api/v1/classes/") {
            reconciliationRevision = try await client.fetchClass(classId: id).progressRevision ?? 0
        } else {
            reconciliationRevision = try await client.fetchPractice(sessionId: id).progressRevision ?? 0
        }
    }

    func confirmReconciliation() {
        guard let latest = reconciliationRevision else { return }
        revision = latest
        reconciliationRevision = nil
        paused = false
        Task { await flush() }
    }

    func retry() {
        paused = false
        Task { await flush() }
    }
}
