import SwiftUI

struct PracticeStartView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let start: SottoPracticeStart

    @State private var answers: [String: Int] = [:]

    private var items: [SottoPracticeItem] {
        start.items ?? []
    }

    private var allAnswered: Bool {
        !items.isEmpty && items.allSatisfy { answers[$0.id] != nil }
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
                        practiceItems
                        promptSections
                    }
                }
                .padding(28)
                .frame(maxWidth: 940, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Full catch-up")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    ProfileToolbarMenu {
                        dismiss()
                    }

                    Button {
                        Task {
                            let payload = answers.map { SottoPracticeAnswer(itemId: $0.key, selectedIndex: $0.value) }
                            await model.submitPracticeAnswers(payload)
                        }
                    } label: {
                        Label("Submit", systemImage: "checkmark.circle.fill")
                    }
                    .disabled(!allAnswered)
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Full catch-up")
                .font(.system(size: 40, weight: .bold, design: .serif))
                .foregroundStyle(SottoTheme.ink)
            Text(statusCopy)
                .font(.title3)
                .foregroundStyle(SottoTheme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var statusCopy: String {
        if start.status == "unavailable" {
            return "Sotto does not have enough due material for this practice type yet."
        }
        return "\(answers.count) of \(items.count) multiple-choice items answered. Speaking and writing prompts are shown for live practice."
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
                PromptBlock(title: "Speaking practice", icon: "waveform", prompts: speakingPrompts.map {
                    "\($0.targetPhrase) - \($0.translation)"
                })
            }

            if let writingPrompts = start.writingPrompts, !writingPrompts.isEmpty {
                PromptBlock(title: "Writing practice", icon: "square.and.pencil", prompts: writingPrompts.map(\.task))
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
