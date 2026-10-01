import SwiftUI

struct PracticeStartView: View {
    @Environment(\.sottoLayout) private var layout
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let start: SottoPracticeStart

    @State private var answers: [String: Int] = [:]
    @ObservedObject var progress: LearningProgressStore
    @State private var hydrated = false
    @State private var preparationError: String?
    @State private var showingRecovery = false
    @State private var submittedAnswers: [String: Int] = [:]
    @ObservedObject var drafts: WritingDraftStore

    private var currentStart: SottoPracticeStart {
        model.practiceStart?.sessionId == start.sessionId ? (model.practiceStart ?? start) : start
    }

    private var writingPrompts: [SottoWritingPrompt] {
        (currentStart.writingPrompts ?? []).map { original in
            var prompt = original
            prompt.savedDraft = currentStart.writingDrafts?[prompt.id] ?? prompt.savedDraft
            return prompt
        }
    }

    private var items: [SottoPracticeItem] {
        currentStart.items ?? []
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

                    if let result = model.practiceResult ?? currentStart.submissionResult {
                        PracticeResultBanner(result: result)
                        PracticeReceiptFeedback(result: result)
                    }

                    if currentStart.status == "preparing" {
                        preparationControls
                    } else if currentStart.status == "unavailable" {
                        UnavailablePractice(reason: currentStart.reason)
                    } else if model.practiceResult == nil && currentStart.submissionResult == nil {
                        if let episodeId = currentStart.episodeId {
                            PracticeListeningPlayer(episodeId: episodeId)
                        }

                        practiceItems
                        promptSections
                        if model.practiceResult == nil && currentStart.submissionResult == nil { submitBar }
                    }
                }
                .padding(layout == .compact ? 16 : 28)
                .frame(maxWidth: 940, alignment: .leading)
            }
            .task(id: "\(currentStart.sessionId)/\(currentStart.status)/\(currentStart.preparationStatus ?? "")") {
                if currentStart.status == "preparing" {
                    while !Task.isCancelled && model.practiceStart?.status == "preparing" {
                        do {
                            try await model.refreshPractice(sessionId: start.sessionId)
                            if !["QUEUED", "RUNNING", "CANCELLING"].contains(model.practiceStart?.preparationStatus ?? "") { return }
                            try await Task.sleep(for: .seconds(2))
                        } catch {
                            if !Task.isCancelled { preparationError = error.localizedDescription }
                            return
                        }
                    }
                } else if !hydrated {
                    progress.configure(client: model.makeClient(), path: "/api/v1/practice/\(start.sessionId)",
                        revision: currentStart.progressRevision ?? 0)
                    answers = progress.answers ?? currentStart.learnerAnswers ?? [:]
                    drafts.register(writingPrompts, savedDrafts: currentStart.writingDrafts ?? [:])
                    hydrated = true
                }
            }
            .onChange(of: answers) { _, _ in saveProgress() }
            .onChange(of: drafts.texts) { _, _ in saveProgress() }
            .onDisappear { Task { await progress.flush() } }
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
            LearningSaveFailureView(progress: progress)
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
                            includingUnchanged: false
                        )
                        guard graded else { return }

                        await model.submitPracticeAnswers(everyAnswer)
                        submittedAnswers = answers
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
        if !hasChanges { return "Finishes this session using every answer and the saved speaking and writing grades." }

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

    private func saveProgress() {
        guard hydrated, model.practiceResult == nil, currentStart.submissionResult == nil else { return }
        progress.update(answers: answers, writingDrafts: drafts.texts)
    }

    private var preparationControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(currentStart.message ?? "Preparing practice.").foregroundStyle(SottoTheme.muted)
            if let preparationError { Text(preparationError).foregroundStyle(.red) }
            Button("Check status") {
                Task {
                    do { try await model.refreshPractice(sessionId: start.sessionId); preparationError = nil }
                    catch { preparationError = error.localizedDescription }
                }
            }.buttonStyle(.bordered)
            if currentStart.canRecover == true {
                Button("Recover interrupted preparation") { showingRecovery = true }.buttonStyle(.bordered)
            } else if ["QUEUED", "RUNNING"].contains(currentStart.preparationStatus ?? "") {
                Button("Cancel preparation", role: .destructive) {
                    Task {
                        do { try await model.practiceGenerationAction(sessionId: start.sessionId, action: "cancel") }
                        catch { preparationError = error.localizedDescription }
                    }
                }.buttonStyle(.bordered)
            }
        }
        .confirmationDialog("Recover interrupted preparation?", isPresented: $showingRecovery, titleVisibility: .visible) {
            Button("Acknowledge and recover") {
                Task {
                    do { try await model.practiceGenerationAction(sessionId: start.sessionId, action: "recover", acknowledgeUnknownOutcome: true) }
                    catch { preparationError = error.localizedDescription }
                }
            }
            Button("Keep waiting", role: .cancel) {}
        } message: {
            Text("An interrupted provider request may have incurred charges. Recovery waits for active work to settle.")
        }
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
        switch currentStart.kind {
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
        if currentStart.status == "unavailable" {
            return "Sotto does not have enough due material for this practice type yet."
        }
        return "\(answers.count) of \(items.count) choices answered. Finish after every required speaking and writing exercise has feedback."
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
            ForEach(currentStart.skillRequirements?.exemptions ?? [], id: \.self) { skill in
                Text("\(skill.capitalized) is exempt because its speech provider is not connected.")
                    .foregroundStyle(SottoTheme.muted)
            }
            if let speakingPrompts = currentStart.speakingPrompts, !speakingPrompts.isEmpty {
                ClassSpeakingPracticeView(
                    source: .practice(sessionId: start.sessionId),
                    prompts: speakingPrompts
                )
            }

            if !writingPrompts.isEmpty {
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
            if let passage = item.passageText, !passage.isEmpty {
                Text(passage)
                    .font(.body)
                    .foregroundStyle(SottoTheme.ink)
            }
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
                Text("\(result.correct) of \(result.answered ?? result.total) choices correct. \(result.graded ?? 0) speaking and writing exercises graded. \(Int(result.score * 100))% score.")
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
