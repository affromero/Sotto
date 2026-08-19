import SwiftUI

/// Where a writing prompt is being answered from. Class and practice post to
/// different routes but grade identically, so the card only needs to know
/// which submit call to make.
enum WritingPromptSource: Equatable {
    case classSession(classId: String)
    case practice(sessionId: String)
}

struct WritingPracticeView: View {
    let source: WritingPromptSource
    let prompts: [SottoWritingPrompt]
    let onSelectionHelp: ((String, String) -> Void)?

    init(
        source: WritingPromptSource,
        prompts: [SottoWritingPrompt],
        onSelectionHelp: ((String, String) -> Void)? = nil
    ) {
        self.source = source
        self.prompts = prompts
        self.onSelectionHelp = onSelectionHelp
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Writing", systemImage: "square.and.pencil")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            ForEach(prompts.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { prompt in
                WritingPromptCard(
                    source: source,
                    prompt: prompt,
                    onSelectionHelp: onSelectionHelp
                )
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct WritingPromptCard: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.sottoLayout) private var layout

    let source: WritingPromptSource
    let prompt: SottoWritingPrompt
    let onSelectionHelp: ((String, String) -> Void)?

    @State private var text: String
    @State private var grade: SottoWritingGrade?
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    init(
        source: WritingPromptSource,
        prompt: SottoWritingPrompt,
        onSelectionHelp: ((String, String) -> Void)?
    ) {
        self.source = source
        self.prompt = prompt
        self.onSelectionHelp = onSelectionHelp
        _text = State(initialValue: prompt.latestResponse?.text ?? "")
        if let previous = prompt.latestResponse, let score = previous.overallScore {
            _grade = State(
                initialValue: SottoWritingGrade(
                    overallScore: score,
                    corrections: previous.corrections ?? [],
                    feedback: previous.feedback ?? ""
                )
            )
        }
    }

    private var trimmedText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The route caps the body at 4000 characters, so stop the learner here
    /// rather than losing a long answer to a 400.
    private var isOverLimit: Bool { trimmedText.count > 4000 }

    private var canSubmit: Bool {
        !trimmedText.isEmpty && !isOverLimit && !isSubmitting
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SottoAdaptiveStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(prompt.task)
                        .font(.body)
                        .foregroundStyle(SottoTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if let guidance = prompt.guidance, !guidance.isEmpty {
                        Text(guidance)
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                if layout != .compact {
                    Spacer(minLength: 12)
                }

                if let score = grade?.overallScore {
                    Text(percentLabel(score))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(SottoTheme.primary)
                }
            }

            TextEditor(text: $text)
                .font(.body)
                .frame(minHeight: layout == .compact ? 130 : 160)
                .scrollContentBackground(.hidden)
                .padding(10)
                .background(SottoTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(isOverLimit ? Color.red.opacity(0.6) : SottoTheme.line)
                )
                .disabled(isSubmitting)

            HStack(spacing: 12) {
                Button {
                    Task { await submit() }
                } label: {
                    Label(
                        isSubmitting ? "Grading" : (grade == nil ? "Submit" : "Submit again"),
                        systemImage: "checkmark.circle"
                    )
                }
                .buttonStyle(SottoPrimaryButtonStyle())
                .disabled(!canSubmit)

                if isOverLimit {
                    Text("\(trimmedText.count) / 4000 characters")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.red)
                } else if isSubmitting {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let grade {
                WritingGradeView(grade: grade, onSelectionHelp: onSelectionHelp)
            }
        }
        .padding(14)
        .background(SottoTheme.surface.opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    private func submit() async {
        guard canSubmit else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let answer = trimmedText
            switch source {
            case let .classSession(classId):
                grade = try await model.submitClassWriting(
                    classId: classId,
                    promptId: prompt.id,
                    text: answer
                )
            case let .practice(sessionId):
                grade = try await model.submitPracticeWriting(
                    sessionId: sessionId,
                    promptId: prompt.id,
                    text: answer
                )
            }
        } catch {
            errorMessage = SottoWritingFailure.message(for: error)
        }
    }
}

private struct WritingGradeView: View {
    let grade: SottoWritingGrade
    let onSelectionHelp: ((String, String) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !grade.feedback.isEmpty {
                Text(grade.feedback)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !grade.corrections.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Corrections")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.muted)
                        .textCase(.uppercase)

                    ForEach(grade.corrections) { correction in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(correction.old)
                                    .font(.callout)
                                    .strikethrough()
                                    .foregroundStyle(SottoTheme.muted)
                                Image(systemName: "arrow.right")
                                    .font(.caption2)
                                    .foregroundStyle(SottoTheme.muted)
                                Text(correction.new)
                                    .font(.callout.bold())
                                    .foregroundStyle(SottoTheme.primary)
                            }
                            .fixedSize(horizontal: false, vertical: true)

                            Text(correction.why)
                                .font(.caption)
                                .foregroundStyle(SottoTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .onTapGesture {
                            onSelectionHelp?(correction.new, correction.why)
                        }
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// The writing routes answer a failed grade with the raw server-side message,
/// which can name environment variables and server settings. This device only
/// connects to a server; it never configures one, so those are rewritten into
/// something a learner can act on.
enum SottoWritingFailure {
    static func message(for error: Error) -> String {
        let raw = error.localizedDescription
        return isServerConfiguration(raw)
            ? "Your Sotto server cannot grade writing yet. Its language model needs to be set up on the web app."
            : raw
    }

    private static func isServerConfiguration(_ message: String) -> Bool {
        let lowered = message.lowercased()
        return ["api key", "api_key", "byok", "not configured", "no provider", "env"]
            .contains { lowered.contains($0) }
    }
}

private func percentLabel(_ score: Double) -> String {
    "\(Int((max(0, min(1, score)) * 100).rounded()))%"
}
