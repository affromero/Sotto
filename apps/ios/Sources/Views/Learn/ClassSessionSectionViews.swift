import SwiftUI
import UIKit
import PencilKit

struct ClassQuizHistoryView: View {
    let history: [SottoQuizHistory]
    let orphanAnswers: [SottoOrphanQuizAnswer]
    let receipts: [SottoQuizReceipt]
    let unreadable: Bool

    var body: some View {
        if !history.isEmpty || !orphanAnswers.isEmpty || !receipts.isEmpty || unreadable {
            DisclosureGroup("Previous quiz work") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Tasks and choices are the currently saved versions. Earlier wording may have changed.")
                        .font(.callout).foregroundStyle(SottoTheme.muted)
                    ForEach(Array(receipts.enumerated()), id: \.offset) { _, receipt in
                        Text(receipt.attempt.map { "Saved submission · Attempt \($0)" } ?? "Saved submission").font(.headline)
                        if let submittedAt = receipt.submittedAt { Text("Submitted at: \(submittedAt)") }
                        Text(receipt.passed.map { $0 ? "Passed" : "Not passed" } ?? "Outcome unavailable")
                        Text(scoreLabel(receipt.overallScore))
                        if receipt.passedSections != nil || receipt.totalSections != nil {
                            Text("Recorded: \(receipt.passedSections.map { String($0) } ?? "?") of \(receipt.totalSections.map { String($0) } ?? "?") skills passed")
                        }
                        ForEach(Array(receipt.sections.enumerated()), id: \.offset) { _, section in
                            Text("\(section.skill.map(classSkillLabel) ?? "Skill unavailable") · \(scoreLabel(section.score)) · \(section.passed.map { $0 ? "Passed" : "Not passed" } ?? "Outcome unavailable")")
                        }
                        if receipt.summaryIncomplete { Text("Some result details are unavailable.") }
                        if receipt.answersUnavailable { Text("Some individual answers are unavailable.") }
                    }
                    ForEach(history) { section in
                        Text("\(classSkillLabel(section.skill)) · Attempt \(section.attempt)").font(.headline)
                        ForEach(section.questions) { question in
                            if let passage = question.passageText { Text(passage) }
                            Text(question.question).font(.subheadline.bold())
                            if let choice = question.savedChoice {
                                Text("Saved choice: \(choiceLabel(question.options, choice))")
                            }
                            ForEach(Array(question.submissions.enumerated()), id: \.offset) { _, event in
                                submission(event, options: question.options)
                            }
                        }
                    }
                    ForEach(Array(orphanAnswers.enumerated()), id: \.offset) { _, answer in
                        Text("Answer without its original task").font(.subheadline.bold())
                        if let choice = answer.savedChoice { Text("Saved choice: \(choiceLabel(nil, choice))") }
                        ForEach(Array(answer.submissions.enumerated()), id: \.offset) { _, event in
                            submission(event, options: nil)
                        }
                    }
                    if unreadable { Text("Some previous quiz records could not be displayed.") }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func choiceLabel(_ options: [String]?, _ selected: Int?) -> String {
        guard let selected else { return "Choice unavailable" }
        if let options, options.indices.contains(selected) { return "\(selected + 1). \(options[selected])" }
        return "Choice index \(selected) (text unavailable)"
    }

    private func scoreLabel(_ score: Double?) -> String {
        guard let score else { return "Score unavailable" }
        if score < 0 || score > 1 { return "Recorded score: \(score) (outside expected range)" }
        return "Score: \(score.formatted(.percent.precision(.fractionLength(0))))"
    }

    private func submission(_ event: SottoHistoricalQuizSubmission, options: [String]?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(event.attempt.map { "Submitted · Attempt \($0)" } ?? "Submitted").font(.caption.bold())
            if let submittedAt = event.submittedAt { Text("Submitted at: \(submittedAt)").font(.caption) }
            Text("\(choiceLabel(options, event.selectedIndex)) · \(event.isCorrect.map { $0 ? "Correct" : "Incorrect" } ?? "Outcome unavailable")")
        }
    }
}

struct ClassSpeakingHistoryView: View {
    let classId: String
    let history: [SottoSpeakingHistory]
    let unlinked: [SottoHistoricalSpeakingRecording]

    var body: some View {
        if !history.isEmpty || !unlinked.isEmpty {
            DisclosureGroup("Previous speaking work") {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(history) { section in
                        Text("Attempt \(section.attempt)").font(.headline)
                        ForEach(section.prompts) { prompt in
                            Text(prompt.targetPhrase).font(.subheadline.bold())
                            Text(prompt.translation)
                            ForEach(prompt.recordings) { recording in
                                if let reference = speakingHistoryAudioPath(classId: classId, promptId: prompt.id, recordingId: recording.id) {
                                    LearnerAudioPlayer(reference: reference)
                                } else { Text("Recording unavailable.") }
                                recordingView(recording)
                            }
                        }
                    }
                    ForEach(unlinked) { recording in
                        Text("Recording without its original task").font(.headline)
                        recordingView(recording)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func recordingView(_ recording: SottoHistoricalSpeakingRecording) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Recording: \(recording.status)")
            if recording.attemptMatches == false { Text("Saved with a different attempt number.") }
            if let transcript = recording.transcript { Text("Transcript: \(transcript)").textSelection(.enabled) }
            if let score = recording.overallScore { Text("Score: \(score.formatted(.percent.precision(.fractionLength(0))))") }
            if let feedback = recording.feedback { Text("Feedback: \(feedback)").textSelection(.enabled) }
            ForEach(recording.rubricScores.keys.sorted(), id: \.self) { key in
                if let score = recording.rubricScores[key] {
                    Text("\(key): \(score.formatted(.percent.precision(.fractionLength(0))))")
                }
            }
            ForEach(Array(recording.phonemeScores.enumerated()), id: \.offset) { _, token in
                Text("\(token.op): \(token.expected ?? "unavailable") → \(token.actual ?? "unavailable")")
            }
            if recording.detailsUnavailable { Text("Some speaking feedback could not be displayed.") }
        }
    }
}

func speakingHistoryAudioPath(classId: String, promptId: String, recordingId: String) -> String? {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
    guard [classId, promptId, recordingId].allSatisfy({ !$0.isEmpty && $0.count <= 200 && $0.unicodeScalars.allSatisfy { allowed.contains($0) } }) else { return nil }
    return "/api/v1/classes/\(classId)/speaking/\(promptId)/recordings/\(recordingId)/audio"
}

struct ClassWritingHistoryView: View {
    let history: [SottoWritingHistory]
    let orphanDrafts: [SottoOrphanWritingDraft]

    var body: some View {
        if !history.isEmpty || !orphanDrafts.isEmpty {
            DisclosureGroup("Previous writing") {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(history) { section in
                        Text("Attempt \(section.attempt)").font(.headline)
                        ForEach(section.prompts) { prompt in
                            Text(prompt.task).font(.subheadline.bold())
                            if let draft = prompt.savedDraft {
                                Text("Saved draft").font(.caption.bold())
                                Text(draft.isEmpty ? "(Empty draft)" : draft)
                                    .textSelection(.enabled)
                            }
                            ForEach(prompt.responses) { response in
                                Text(response.overallScore == nil ? "Submitted response" : "Graded response")
                                    .font(.caption.bold())
                                Text(response.text).textSelection(.enabled)
                                if !response.attemptMatches {
                                    Text("Saved with a different attempt number.")
                                }
                                if let score = response.overallScore {
                                    Text("Score: \(score.formatted(.percent.precision(.fractionLength(0))))")
                                }
                                if let feedback = response.feedback { Text(feedback) }
                                ForEach(response.corrections ?? []) { correction in
                                    Text("\(correction.old) → \(correction.new): \(correction.why)")
                                }
                                if response.correctionsUnavailable {
                                    Text("Some corrections could not be displayed.")
                                }
                            }
                        }
                    }
                    ForEach(orphanDrafts) { draft in
                        Text("Saved draft without its original task").font(.caption.bold())
                        Text(draft.text.isEmpty ? "(Empty draft)" : draft.text)
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

struct ClassSectionView: View {
    let classId: String
    let section: SottoClassSection
    @Binding var answers: [String: Int]
    @ObservedObject var drafts: WritingDraftStore
    let pencilWorkbook: Bool
    let classAttempt: Int
    var speakingBinding: SottoClassSpeakingBinding? = nil
    var activityOwner: SottoLearnerIdentity? = nil
    let pencilToolPicker: PKToolPicker
    var prerequisite: SottoClassPrerequisiteResponse? = nil
    let onPencilReviewRequired: (String, Bool) -> Void
    let onSelectionHelp: (String, String) -> Void
    @State private var questionIndex = 0

    private var skill: String {
        section.skill.uppercased()
    }

    private var sortedQuestions: [SottoQuestion] {
        section.questions.sorted { $0.order < $1.order }
    }

    private var sharedReadingPassage: String? {
        guard skill == "READING" else { return nil }
        return sortedQuestions.first { ($0.passageText ?? "").isEmpty == false }?.passageText
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                HStack(spacing: 12) {
                    Image(systemName: classSkillIcon(section.skill))
                        .font(.title3)
                        .foregroundStyle(classSkillColor(section.skill))
                        .frame(width: 44, height: 44)
                        .background(classSkillColor(section.skill).opacity(0.13))
                        .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 4) {
                        Text(classSkillLabel(section.skill))
                            .font(.title2.bold())
                            .foregroundStyle(SottoTheme.ink)
                        Text("\(section.status.capitalized) · \(sectionStatusLabel(section))")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                    }
                }
                Spacer()
                if let score = section.score {
                    Text("\(Int(score * 100))%")
                        .font(.headline)
                        .foregroundStyle(section.passed == true ? SottoTheme.success : SottoTheme.primary)
                }
            }

            if skill == "LISTENING" {
                ClassListeningAudioBlock(episode: section.episode)
            }

            if let sharedReadingPassage {
                ClassReadingPassageBlock(passage: sharedReadingPassage, onSelectionHelp: onSelectionHelp)
            }

            ForEach(pencilWorkbook ? sortedQuestions : Array(sortedQuestions.dropFirst(questionIndex).prefix(1))) { question in
                if let prerequisite, let instruction = prerequisite.content?.directions.instruction(
                    sectionId: section.id, taskId: question.id, kind: .question
                ) {
                    ClassPrerequisiteDirection(instruction: instruction, language: prerequisite.nativeLang)
                }
                if pencilWorkbook {
                    PencilHomeworkCard(classId: classId, attempt: classAttempt, exercise: .question(question),
                        toolPicker: pencilToolPicker,
                        confirmedAnswer: answers[question.id].map { .choice($0) }, onUseAnswer: { answer in
                            if case .choice(let index) = answer { answers[question.id] = index }
                        }, onReviewRequired: { onPencilReviewRequired(question.id, $0) })
                }
                QuestionView(
                    question: question,
                    selectedIndex: answers[question.id],
                    showsPassage: sharedReadingPassage == nil,
                    onSelectionHelp: onSelectionHelp
                ) { selected in
                    answers[question.id] = selected
                }
            }

            if !pencilWorkbook, !sortedQuestions.isEmpty {
                Text("Question \(questionIndex + 1) of \(sortedQuestions.count)")
                    .font(.caption).foregroundStyle(SottoTheme.muted)
                ViewThatFits(in: .horizontal) {
                    HStack { questionActions }
                    VStack(alignment: .leading, spacing: 12) { questionActions }
                }
                .buttonStyle(.bordered).controlSize(.large)
            }

            if !section.prompts.isEmpty {
                ClassSpeakingPracticeView(
                    source: .classSession(classId: classId),
                    prompts: section.prompts,
                    classBinding: speakingBinding,
                    activityOwner: activityOwner,
                    prerequisite: prerequisite,
                    sectionId: section.id,
                    onSelectionHelp: onSelectionHelp
                )
            }

            if !section.writingPrompts.isEmpty {
                if pencilWorkbook {
                    ForEach(section.writingPrompts) { prompt in
                        if let prerequisite, let instruction = prerequisite.content?.directions.instruction(
                            sectionId: section.id, taskId: prompt.id, kind: .writing
                        ) {
                            ClassPrerequisiteDirection(instruction: instruction, language: prerequisite.nativeLang)
                        }
                        PencilHomeworkCard(classId: classId, attempt: classAttempt, exercise: .writing(prompt),
                            toolPicker: pencilToolPicker,
                            confirmedAnswer: drafts.draft(for: prompt.id).map { .writing($0.text) }, onUseAnswer: { answer in
                                if case .writing(let text) = answer { drafts.binding(for: prompt.id).wrappedValue = text }
                            }, onReviewRequired: { onPencilReviewRequired(prompt.id, $0) })
                    }
                }
                WritingPracticeView(
                    drafts: drafts,
                    prompts: section.writingPrompts,
                    offersHandwriting: !pencilWorkbook,
                    prerequisite: prerequisite,
                    sectionId: section.id,
                    onSelectionHelp: onSelectionHelp
                )
            }
        }
        .padding(22)
        .background(
            LinearGradient(
                colors: [SottoTheme.surface, classSkillColor(section.skill).opacity(0.06)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    @ViewBuilder
    private var questionActions: some View {
        Button("Previous question") { questionIndex -= 1 }
            .disabled(questionIndex == 0)
        Button("Next question") { questionIndex += 1 }
            .disabled(questionIndex + 1 >= sortedQuestions.count)
    }
}

private struct ClassListeningAudioBlock: View {
    let episode: SottoClassEpisode?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "waveform.circle.fill")
                    .font(.title2)
                    .foregroundStyle(SottoTheme.primary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(episode?.title ?? "Listening audio")
                        .font(.headline)
                        .foregroundStyle(SottoTheme.ink)
                    Text(episode == nil ? "Listening was not attached to this generated class." : "Listen first, then answer below.")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                }
                Spacer()
            }

            if let episode {
                EpisodeListeningPlayer(episodeId: episode.id)
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

}

private struct ClassReadingPassageBlock: View {
    let passage: String
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        SelectableLearnerText(
            passage,
            font: LearnerTextFonts.body,
            color: UIColor(SottoTheme.ink),
            onExamples: onSelectionHelp
        )
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [
                    SottoTheme.paper,
                    SottoTheme.primary.opacity(0.08),
                    SottoTheme.readingTint,
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(SottoTheme.primary.opacity(0.18))
        )
    }
}

struct ClassFeedbackClinicBlock: View {
    @Environment(\.sottoLayout) private var layout
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let classDetail: SottoClassDetail
    let result: SottoClassSubmitResult?

    private var weakSections: [SottoClassSectionResult] {
        (result?.sections ?? [])
            .filter { !$0.passed || $0.score < 0.82 }
            .sorted { $0.score < $1.score }
    }

    private var speakingFeedback: [(prompt: SottoSpeakingPrompt, recording: SottoSpeakingRecording)] {
        classDetail.sections
            .flatMap(\.prompts)
            .compactMap { prompt in
                guard let recording = prompt.latestRecording, recording.status == "SCORED" else {
                    return nil
                }
                return (prompt: prompt, recording: recording)
            }
    }

    private var vocabulary: [SottoClassVocabularyItem] {
        classDetail.vocabulary ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Coach's review")
                        .font(.caption.bold())
                        .foregroundStyle(SottoTheme.primary)
                        .textCase(.uppercase)
                        .tracking(1.1)
                    Text("Feedback Clinic")
                        .font(.title2.bold())
                        .foregroundStyle(SottoTheme.ink)
                }

                Spacer()
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()),
                count: layout == .compact || dynamicTypeSize.isAccessibilitySize ? 1 : 2),
                alignment: .leading, spacing: 12) {
                ClinicCard(title: "Targeted drills") {
                    if weakSections.isEmpty {
                        Text("No weak skill score stood out in this attempt.")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(weakSections) { section in
                                HStack {
                                    Text(classSkillLabel(section.skill))
                                    Spacer()
                                    Text(percent(section.score))
                                        .font(.callout.monospacedDigit())
                                        .foregroundStyle(SottoTheme.primary)
                                }
                                .padding(12)
                                .background(SottoTheme.paper)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                        }
                    }
                }

                ClinicCard(title: "Pronunciation") {
                    if speakingFeedback.isEmpty {
                        Text("Record speaking prompts to unlock voice-based feedback.")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(speakingFeedback.prefix(3).enumerated()), id: \.offset) { _, item in
                                PronunciationFeedbackRow(prompt: item.prompt, recording: item.recording)
                            }
                        }
                    }
                }

                ClinicCard(title: "Vocabulary") {
                    if vocabulary.isEmpty {
                        Text("No lesson vocabulary was attached to this class.")
                            .font(.callout)
                            .foregroundStyle(SottoTheme.muted)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            LazyVGrid(columns: [dynamicTypeSize.isAccessibilitySize
                                ? GridItem(.flexible())
                                : GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 8) {
                                ForEach(vocabulary.prefix(10), id: \.lemma) { item in
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.lemma)
                                            .font(.callout.bold())
                                            .foregroundStyle(SottoTheme.ink)
                                        Text(item.gloss)
                                            .font(.caption)
                                            .foregroundStyle(SottoTheme.muted)
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 8)
                                    .background(SottoTheme.primary.opacity(0.08))
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                            }
                            Text("These words stay with the class and feed the learner vocabulary review after submission.")
                                .font(.callout)
                                .foregroundStyle(SottoTheme.muted)
                        }
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
}

struct ClinicCard<Content: View>: View {
    let title: String
    private let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.muted)
                .textCase(.uppercase)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }
}

struct PronunciationFeedbackRow: View {
    let prompt: SottoSpeakingPrompt
    let recording: SottoSpeakingRecording

    private var focusTokens: [SottoSpeakingAlignmentToken] {
        (recording.phonemeScores ?? [])
            .filter { $0.op != "match" }
            .prefix(3)
            .map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(prompt.targetPhrase)
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                Spacer()
                if let score = recording.overallScore {
                    Text(percent(score))
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(SottoTheme.primary)
                }
            }

            if let transcript = recording.transcript, !transcript.isEmpty {
                Text("\"\(transcript)\"")
                    .font(.callout.italic())
                    .foregroundStyle(SottoTheme.muted)
            }

            if let rubric = recording.rubricScores {
                HStack(spacing: 6) {
                    ForEach(["accuracy", "fluency", "completeness"], id: \.self) { key in
                        if let value = rubric[key] {
                            Text("\(key) \(percent(value))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(SottoTheme.muted)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(SottoTheme.surface)
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            if !focusTokens.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(focusTokens.enumerated()), id: \.offset) { _, token in
                        Text(focusText(token))
                            .font(.caption.monospaced())
                            .foregroundStyle(Color.red.opacity(0.8))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.red.opacity(0.08))
                            .clipShape(Capsule())
                    }
                }
            }

            if let feedback = recording.feedback, !feedback.isEmpty {
                Text(feedback)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }

            if let reference = prompt.referenceTtsUrl {
                LearnerAudioPlayer(reference: reference)
            }
        }
        .padding(12)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

struct QuestionView: View {
    let question: SottoQuestion
    let selectedIndex: Int?
    let showsPassage: Bool
    let onSelectionHelp: (String, String) -> Void
    let onSelect: (Int) -> Void

    init(
        question: SottoQuestion,
        selectedIndex: Int?,
        showsPassage: Bool = true,
        onSelectionHelp: @escaping (String, String) -> Void,
        onSelect: @escaping (Int) -> Void
    ) {
        self.question = question
        self.selectedIndex = selectedIndex
        self.showsPassage = showsPassage
        self.onSelectionHelp = onSelectionHelp
        self.onSelect = onSelect
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showsPassage, let passage = question.passageText, !passage.isEmpty {
                SelectableLearnerText(
                    passage,
                    font: LearnerTextFonts.body,
                    color: UIColor(SottoTheme.muted),
                    onExamples: onSelectionHelp
                )
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SottoTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            SelectableLearnerText(
                question.question,
                font: LearnerTextFonts.headline,
                color: UIColor(SottoTheme.ink),
                onExamples: onSelectionHelp
            )

            VStack(spacing: 8) {
                ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
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

            if selectedIndex != nil, let explanation = question.explanation, !explanation.isEmpty {
                SelectableLearnerText(
                    explanation,
                    font: LearnerTextFonts.callout,
                    color: UIColor(SottoTheme.muted),
                    onExamples: onSelectionHelp
                )
            }
        }
    }
}
