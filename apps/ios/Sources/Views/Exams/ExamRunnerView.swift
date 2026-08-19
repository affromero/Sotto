import AVFoundation
import SwiftUI

/// Sits one mock exam: mixed-skill sections, then a band result.
///
/// Speaking and writing are graded through their own routes while the learner
/// works; the submit call carries only the multiple-choice answers and the
/// server folds the rest in. So submitting before those finish silently loses
/// them, and the view says so rather than letting it happen quietly.
struct ExamRunnerView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.sottoLayout) private var layout

    let examId: String

    @State private var exam: SottoExamDetail?
    @State private var answers: [String: Int] = [:]
    @State private var score: SottoExamScoreResult?
    @State private var loadError: String?
    @State private var isSubmitting = false

    private var questions: [SottoExamQuestion] {
        (exam?.sections ?? []).flatMap(\.questions)
    }

    private var readySections: [SottoExamSection] {
        (exam?.sections ?? [])
            .filter { $0.status != "FAILED" }
            .sorted { $0.order < $1.order }
    }

    private var failedSections: [SottoExamSection] {
        (exam?.sections ?? []).filter { $0.status == "FAILED" }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let exam {
                    header(exam)

                    if exam.allSectionsFailed {
                        ExamNoticeCard(
                            title: "This exam could not be built",
                            message: "Your Sotto server could not generate any section. Its language model or voice provider needs attention on the web app.",
                            systemImage: "exclamationmark.triangle"
                        )
                    } else {
                        if !failedSections.isEmpty {
                            ExamNoticeCard(
                                title: "Some sections are missing",
                                message: "\(failedSections.count) of \(exam.sections.count) sections could not be built, so they are left out of the score.",
                                systemImage: "exclamationmark.circle"
                            )
                        }

                        ForEach(readySections) { section in
                            examSection(section, exam: exam)
                        }

                        resultOrSubmit(exam)
                    }
                } else if let loadError {
                    ExamNoticeCard(
                        title: "Could not load the exam",
                        message: loadError,
                        systemImage: "exclamationmark.triangle"
                    )
                } else {
                    ProgressView("Loading exam")
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 40)
                }
            }
            .padding(layout.pagePadding)
            .frame(maxWidth: layout.readableWidth, alignment: .leading)
        }
        .background(SottoTheme.paper)
        .navigationTitle(exam?.examName ?? "Exam")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ exam: SottoExamDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(exam.institutionLabel.uppercased())
                .font(.caption.bold())
                .tracking(1.6)
                .foregroundStyle(SottoTheme.muted)
            Text("\(exam.examName) · \(exam.level)")
                .font(.system(size: layout.heroTitleSize, weight: .semibold, design: .serif))
                .foregroundStyle(SottoTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func examSection(_ section: SottoExamSection, exam: SottoExamDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(section.part)
                    .font(.headline)
                    .foregroundStyle(SottoTheme.ink)
                Spacer()
                Text(section.skill.capitalized)
                    .font(.caption.bold())
                    .foregroundStyle(SottoTheme.primary)
            }

            if let episode = section.episode, let urlString = episode.audioUrl,
               let url = URL(string: urlString) {
                ExamListeningPlayer(url: url)
            } else if section.skill == "LISTENING", section.episode?.audioUrl == nil {
                Text("Audio for this section is still being produced.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
            }

            ForEach(section.questions.sorted { $0.order < $1.order }) { question in
                ExamQuestionView(
                    question: question,
                    selectedIndex: answers[question.id],
                    revealsAnswer: exam.isScored
                ) { selected in
                    answers[question.id] = selected
                }
            }

            if !section.speakingPrompts.isEmpty {
                ClassSpeakingPracticeView(
                    source: .exam(examId: exam.id),
                    prompts: section.speakingPrompts
                )
            }

            if !section.writingPrompts.isEmpty {
                WritingPracticeView(
                    source: .exam(examId: exam.id),
                    prompts: section.writingPrompts
                )
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    @ViewBuilder
    private func resultOrSubmit(_ exam: SottoExamDetail) -> some View {
        if let result = score ?? exam.result.map(fromExamResult) {
            examResultCard(result)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                Text("Record every speaking prompt and submit every writing prompt before you finish. Only the multiple-choice answers travel with this button; the rest are graded as you go.")
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                Button {
                    Task { await submit() }
                } label: {
                    Label(isSubmitting ? "Scoring" : "Finish exam", systemImage: "checkmark.seal")
                }
                .buttonStyle(SottoPrimaryButtonStyle())
                .disabled(isSubmitting || answers.count < questions.count)

                if answers.count < questions.count {
                    Text("\(answers.count) of \(questions.count) questions answered.")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(SottoTheme.muted)
                }
            }
        }
    }

    private func examResultCard(_ result: SottoExamScoreResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(result.band)
                    .font(.system(size: 34, weight: .bold, design: .serif))
                    .foregroundStyle(SottoTheme.primary)
                Spacer()
                Text(examPercent(result.overallScore))
                    .font(.title3.monospacedDigit())
                    .foregroundStyle(SottoTheme.ink)
            }

            if !result.feedback.isEmpty {
                Text(result.feedback)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            ForEach(result.sections) { section in
                HStack {
                    Text(section.skill.capitalized)
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                    Spacer()
                    Text(examPercent(section.score))
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(SottoTheme.ink)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(SottoTheme.line)
        )
    }

    /// A previously scored exam carries its result in a different shape than a
    /// fresh submit, so normalise onto the submit shape for one renderer.
    private func fromExamResult(_ result: SottoExamResult) -> SottoExamScoreResult {
        SottoExamScoreResult(
            overallScore: result.overallScore ?? 0,
            band: result.band ?? "",
            feedback: result.feedback ?? "",
            sections: result.sectionResults.map {
                SottoExamSectionScore(
                    sectionId: $0.sectionId,
                    skill: $0.skill,
                    weight: 0,
                    score: $0.score
                )
            }
        )
    }

    private func load() async {
        do {
            let detail = try await model.fetchExam(examId: examId)
            exam = detail
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func submit() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            score = try await model.submitExam(
                examId: examId,
                answers: answers.map { SottoSubmitAnswer(questionId: $0.key, selectedIndex: $0.value) }
            )
            // Refetch so the answer key and per-section scores appear.
            await load()
        } catch {
            loadError = error.localizedDescription
        }
    }
}

private struct ExamListeningPlayer: View {
    let url: URL

    @State private var player: AVPlayer?
    @State private var isPlaying = false

    var body: some View {
        Button {
            toggle()
        } label: {
            Label(
                isPlaying ? "Pause audio" : "Play audio",
                systemImage: isPlaying ? "pause.fill" : "play.fill"
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(SottoSecondaryButtonStyle())
        .onDisappear {
            player?.pause()
            isPlaying = false
        }
    }

    private func toggle() {
        if player == nil {
            player = AVPlayer(url: url)
        }
        if isPlaying {
            player?.pause()
        } else {
            player?.play()
        }
        isPlaying.toggle()
    }
}

private struct ExamQuestionView: View {
    let question: SottoExamQuestion
    let selectedIndex: Int?
    let revealsAnswer: Bool
    let onSelect: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let passage = question.passageText, !passage.isEmpty {
                Text(passage)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SottoTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            Text(question.question)
                .font(.body)
                .foregroundStyle(SottoTheme.ink)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                Button {
                    onSelect(index)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: markIcon(for: index))
                            .foregroundStyle(markColor(for: index))
                        Text(option)
                            .font(.callout)
                            .foregroundStyle(SottoTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SottoTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(revealsAnswer)
            }

            if revealsAnswer, let explanation = question.explanation, !explanation.isEmpty {
                Text(explanation)
                    .font(.caption)
                    .foregroundStyle(SottoTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func markIcon(for index: Int) -> String {
        if revealsAnswer, let correct = question.correctIndex {
            if index == correct { return "checkmark.circle.fill" }
            if index == selectedIndex { return "xmark.circle.fill" }
        }
        return index == selectedIndex ? "largecircle.fill.circle" : "circle"
    }

    private func markColor(for index: Int) -> Color {
        if revealsAnswer, let correct = question.correctIndex {
            if index == correct { return .green }
            if index == selectedIndex { return .red }
        }
        return index == selectedIndex ? SottoTheme.primary : SottoTheme.muted
    }
}
