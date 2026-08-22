import SwiftUI

struct PracticeStartView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let start: SottoPracticeStart

    @State private var answers: [String: Int] = [:]
    @State private var submittedAnswers: [String: Int] = [:]
    @StateObject private var drafts = WritingDraftStore()

    private var items: [SottoPracticeItem] {
        start.items ?? []
    }

    /// Only the choices that moved since the last submit. A second pass after
    /// a result should not re-grade answers the learner left alone.
    private var changedAnswers: [SottoPracticeAnswer] {
        answers
            .filter { submittedAnswers[$0.key] != $0.value }
            .map { SottoPracticeAnswer(itemId: $0.key, selectedIndex: $0.value) }
    }

    private var hasChanges: Bool {
        !changedAnswers.isEmpty || drafts.hasChanges
    }

    private var everyAnswer: [SottoPracticeAnswer] {
        answers.map { SottoPracticeAnswer(itemId: $0.key, selectedIndex: $0.value) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header

                    if let result = model.practiceResult {
                        PracticeResultBanner(result: result)
                    }

                    if start.status == "unavailable" {
                        UnavailablePractice(reason: start.reason)
                    } else {
                        if let episodeId = start.episodeId {
                            PracticeListeningPlayer(episodeId: episodeId)
                        }

                        practiceItems
                        promptSections
                        submitBar
                    }
                }
                .padding(28)
                .frame(maxWidth: 940, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle(practiceTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    ProfileToolbarMenu {
                        dismiss()
                    }
                }
            }
        }
    }

    /// The one place this sheet submits from. It sends the multiple-choice
    /// answers that moved and the writing drafts that were edited, nothing else.
    private var submitBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let message = drafts.errorMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 14) {
                Button {
                    model.run {
                        let graded = await drafts.submit(
                            source: .practice(sessionId: start.sessionId),
                            model: model,
                            includingUnchanged: !hasChanges
                        )
                        guard graded else { return }

                        let payload = hasChanges ? changedAnswers : everyAnswer
                        if !payload.isEmpty {
                            await model.submitPracticeAnswers(payload)
                            submittedAnswers = answers
                        }
                    }
                } label: {
                    Label("Submit", systemImage: "checkmark.circle.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(SottoPrimaryButtonStyle())
                .disabled(drafts.isOverLimit || drafts.isSubmitting)

                Text(submitSummary)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
    }

    private var submitSummary: String {
        if drafts.isOverLimit {
            return "One answer is over the 4000 character limit."
        }
        if !hasChanges {
            return "Nothing changed since the last submit. Sending again re-grades what is here."
        }

        var parts: [String] = []
        if !changedAnswers.isEmpty {
            parts.append("\(changedAnswers.count) choice\(changedAnswers.count == 1 ? "" : "s")")
        }
        let writing = drafts.changedPromptIds.count
        if writing > 0 {
            parts.append("\(writing) written answer\(writing == 1 ? "" : "s")")
        }
        return "Sends \(parts.joined(separator: " and "))."
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(practiceTitle)
                .font(.system(size: 40, weight: .bold, design: .serif))
                .foregroundStyle(SottoTheme.ink)
            Text(statusCopy)
                .font(.title3)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var practiceTitle: String {
        switch start.kind {
        case "GRAMMAR":
            return "Grammar practice"
        case "READING":
            return "Reading practice"
        case "LISTENING":
            return "Listening practice"
        case "SPEAKING":
            return "Speaking practice"
        case "WRITING":
            return "Writing practice"
        case "VOCAB":
            return "Vocabulary practice"
        default:
            return "Full catch-up"
        }
    }

    private var statusCopy: String {
        if start.status == "unavailable" {
            return "Sotto does not have enough due material for this practice type yet."
        }
        return "\(answers.count) of \(items.count) multiple-choice items answered. Speaking is graded as you record; the rest goes with the submit at the end."
    }

    private var practiceItems: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Multiple choice")
                .font(.title2.bold())
                .foregroundStyle(SottoTheme.ink)

            if items.isEmpty {
                Text("No multiple-choice items came back for this session.")
                    .foregroundStyle(SottoTheme.muted)
            } else {
                ForEach(items) { item in
                    PracticeItemView(item: item, selectedIndex: answers[item.id]) { selected in
                        answers[item.id] = selected
                    }
                }
            }
        }
        .padding(22)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    private var promptSections: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let speakingPrompts = start.speakingPrompts, !speakingPrompts.isEmpty {
                ClassSpeakingPracticeView(
                    source: .practice(sessionId: start.sessionId),
                    prompts: speakingPrompts
                )
            }

            if let writingPrompts = start.writingPrompts, !writingPrompts.isEmpty {
                WritingPracticeView(drafts: drafts, prompts: writingPrompts)
            }
        }
    }
}

private struct PracticeItemView: View {
    let item: SottoPracticeItem
    let selectedIndex: Int?
    let onSelect: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(item.prompt)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            ForEach(Array(item.options.enumerated()), id: \.offset) { index, option in
                Button {
                    onSelect(index)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: selectedIndex == index ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(selectedIndex == index ? SottoTheme.primary : SottoTheme.muted)
                        Text(option)
                            .foregroundStyle(SottoTheme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(14)
                    .background(selectedIndex == index ? SottoTheme.primary.opacity(0.08) : SottoTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
    }
}

private struct UnavailablePractice: View {
    let reason: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("No catch-up session available", systemImage: "clock.badge.exclamationmark")
                .font(.title2.bold())
                .foregroundStyle(SottoTheme.ink)
            Text(reasonText)
                .foregroundStyle(SottoTheme.muted)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    private var reasonText: String {
        switch reason {
        case "not_enough_vocab":
            return "Add more learning material or finish a few classes before trying full catch-up."
        case "nothing_due":
            return "There is nothing due right now."
        case "no_content":
            return "This course does not have enough generated content yet."
        default:
            return "Sotto returned this practice session as unavailable."
        }
    }
}

private struct PracticeResultBanner: View {
    let result: SottoPracticeSubmitResult

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 42))
                .foregroundStyle(SottoTheme.success)

            VStack(alignment: .leading, spacing: 4) {
                Text("Practice graded")
                    .font(.title2.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text("\(result.correct) of \(result.total) correct, \(Int(result.score * 100))% score.")
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
            }

            Spacer()
        }
        .padding(20)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}
