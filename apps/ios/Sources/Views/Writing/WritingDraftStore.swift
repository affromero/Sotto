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
        guard drafts[prompt.id] == nil else { return }

        let previous = prompt.latestResponse
        let text = previous?.text ?? ""
        var grade: SottoWritingGrade?
        if let previous, let score = previous.overallScore {
            grade = SottoWritingGrade(
                overallScore: score,
                corrections: previous.corrections ?? [],
                feedback: previous.feedback ?? ""
            )
        }

        drafts[prompt.id] = Draft(
            text: text,
            submittedText: previous?.text.trimmingCharacters(in: .whitespacesAndNewlines),
            grade: grade
        )
    }

    func binding(for promptId: String) -> Binding<String> {
        Binding(
            get: { self.drafts[promptId]?.text ?? "" },
            set: { self.drafts[promptId]?.text = $0 }
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
                let grade: SottoWritingGrade
                switch source {
                case let .classSession(classId):
                    grade = try await model.submitClassWriting(classId: classId, promptId: id, text: answer)
                case let .practice(sessionId):
                    grade = try await model.submitPracticeWriting(sessionId: sessionId, promptId: id, text: answer)
                case let .exam(examId):
                    grade = try await model.submitExamWriting(examId: examId, promptId: id, text: answer)
                }
                drafts[id]?.grade = grade
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
