import SwiftUI

/// The drafts behind a screen's writing prompts, owned by that screen so a
/// single Submit can send them. Each draft remembers the text it was last
/// graded on, which is what makes "only what changed" possible: an untouched
/// answer is not re-sent, and a graded answer that was edited is.
@MainActor
final class WritingDraftStore: ObservableObject {
    struct Draft {
        var text: String
        var submittedText: String?
        var grade: SottoWritingGrade?
        var unknownText: String? = nil

        var trimmed: String {
            text.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        /// The route caps the body at 4000 characters, so stop here rather
        /// than lose a long answer to a 400.
        var isOverLimit: Bool { trimmed.count > 4000 }

        var hasChanged: Bool {
            !trimmed.isEmpty && !isOverLimit && trimmed != submittedText
        }
    }

    @Published private(set) var drafts: [String: Draft] = [:]
    @Published private(set) var isSubmitting = false
    @Published private(set) var errorMessage: String?

    /// Seeds a prompt's draft from whatever the server already graded. Called
    /// as cards appear; an existing draft is left alone so re-rendering never
    /// discards typing.
    func register(_ prompt: SottoWritingPrompt) {
        if var current = drafts[prompt.id] {
            if let previous = prompt.latestResponse, let score = previous.overallScore,
               current.trimmed == previous.text.trimmingCharacters(in: .whitespacesAndNewlines) {
                current.submittedText = current.trimmed
                current.grade = SottoWritingGrade(overallScore: score,
                    corrections: previous.corrections ?? [], feedback: previous.feedback ?? "")
                drafts[prompt.id] = current
            }
            return
        }

        let previous = prompt.latestResponse
        let text = prompt.savedDraft ?? previous?.text ?? ""
        var grade: SottoWritingGrade?
        if let previous, let score = previous.overallScore,
            text.trimmingCharacters(in: .whitespacesAndNewlines) == previous.text.trimmingCharacters(in: .whitespacesAndNewlines) {
            grade = SottoWritingGrade(
                overallScore: score,
                corrections: previous.corrections ?? [],
                feedback: previous.feedback ?? ""
            )
        }

        drafts[prompt.id] = Draft(
            text: text,
            submittedText: grade == nil ? nil : previous?.text.trimmingCharacters(in: .whitespacesAndNewlines),
            grade: grade
        )
    }

    var texts: [String: String] { drafts.mapValues(\.text) }

    func register(_ prompts: [SottoWritingPrompt], savedDrafts: [String: String]) {
        for var prompt in prompts {
            prompt.savedDraft = savedDrafts[prompt.id] ?? prompt.savedDraft
            register(prompt)
        }
    }

    func binding(for promptId: String) -> Binding<String> {
        Binding(
            get: { self.drafts[promptId]?.text ?? "" },
            set: {
                self.drafts[promptId]?.text = $0
                if self.drafts[promptId]?.hasChanged == true { self.drafts[promptId]?.grade = nil }
            }
        )
    }

    func draft(for promptId: String) -> Draft? {
        drafts[promptId]
    }

    var changedPromptIds: [String] {
        drafts.filter { $0.value.hasChanged }.keys.sorted()
    }

    var hasChanges: Bool {
        drafts.values.contains { $0.hasChanged }
    }

    var isOverLimit: Bool {
        drafts.values.contains { $0.isOverLimit }
    }

    /// Grades the drafts the learner touched. `includingUnchanged` re-grades
    /// everything with text in it, which is what the always-available Submit
    /// falls back to when nothing has moved. Returns false when one failed, so
    /// the caller can leave the screen open on the error.
    func submit(
        source: WritingPromptSource,
        model: SottoAppModel,
        includingUnchanged: Bool = false
    ) async -> Bool {
        await submit(source: source, includingUnchanged: includingUnchanged,
            loadLatest: { id in try await model.latestWritingPrompt(source: source, promptId: id) },
            grade: { id, answer in
                switch source {
                case let .classSession(classId):
                    return try await model.submitClassWriting(classId: classId, promptId: id, text: answer)
                case let .practice(sessionId):
                    return try await model.submitPracticeWriting(sessionId: sessionId, promptId: id, text: answer)
                case let .exam(examId):
                    return try await model.submitExamWriting(examId: examId, promptId: id, text: answer)
                }
            })
    }

    func submit(
        source: WritingPromptSource,
        includingUnchanged: Bool = false,
        loadLatest: (String) async throws -> SottoWritingPrompt?,
        grade: (String, String) async throws -> SottoWritingGrade
    ) async -> Bool {
        let ids = includingUnchanged
            ? drafts.filter { !$0.value.trimmed.isEmpty && !$0.value.isOverLimit }.keys.sorted()
            : changedPromptIds
        guard !ids.isEmpty else { return true }

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        for id in ids {
            guard let draft = drafts[id] else { continue }
            let answer = draft.trimmed

            do {
                if let unknown = draft.unknownText {
                    let prompt = try await loadLatest(id)
                    if let prompt, let previous = prompt.latestResponse,
                       previous.overallScore != nil,
                       previous.text.trimmingCharacters(in: .whitespacesAndNewlines) == unknown {
                        drafts[id]?.unknownText = nil
                        register(prompt)
                        if unknown == answer { continue }
                    } else {
                        // Class and practice routes reconcile the original request before dispatch.
                        // Exams do not yet offer that durable request contract.
                        if case .exam = source {
                            errorMessage = "The previous writing outcome is not confirmed. Check again before asking for another grade."
                            return false
                        }
                        guard answer == unknown else {
                            errorMessage = "Restore the previous answer to check its grade before submitting edited text."
                            return false
                        }
                    }
                }
                drafts[id]?.unknownText = answer
                let result = try await grade(id, answer)
                drafts[id]?.unknownText = nil
                drafts[id]?.grade = result
                drafts[id]?.submittedText = answer
            } catch {
                if error is CancellationError || (error as? URLError)?.code == .cancelled {
                    return false
                }
                errorMessage = error.localizedDescription
                return false
            }
        }

        return true
    }
}
