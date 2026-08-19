import AVFoundation
import SwiftUI
import UIKit

struct ClassSectionView: View {
    let classId: String
    let section: SottoClassSection
    @Binding var answers: [String: Int]
    let onSelectionHelp: (String, String) -> Void

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

            ForEach(sortedQuestions) { question in
                QuestionView(
                    question: question,
                    selectedIndex: answers[question.id],
                    showsPassage: sharedReadingPassage == nil,
                    onSelectionHelp: onSelectionHelp
                ) { selected in
                    answers[question.id] = selected
                }
            }

            if !section.prompts.isEmpty {
                if skill == "SPEAKING" {
                    ClassSpeakingPracticeView(
                        classId: classId,
                        prompts: section.prompts,
                        onSelectionHelp: onSelectionHelp
                    )
                } else {
                    PromptBlock(title: "Speaking", icon: "waveform", prompts: section.prompts.map {
                        "\($0.targetPhrase) - \($0.translation)"
                    }, onSelectionHelp: onSelectionHelp)
                }
            }

            if !section.writingPrompts.isEmpty {
                WritingPracticeView(
                    source: .classSession(classId: classId),
                    prompts: section.writingPrompts,
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
}

private struct ClassListeningAudioBlock: View {
    let episode: SottoClassEpisode?

    @State private var player: AVPlayer?
    @State private var isPlaying = false

    private var audioURL: URL? {
        guard let audioUrl = episode?.audioUrl else { return nil }
        return URL(string: audioUrl)
    }

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
                    Text(audioURL == nil ? listeningStatus : "Listen first, then answer below.")
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                }
                Spacer()
            }

            Button {
                togglePlayback()
            } label: {
                Label(isPlaying ? "Pause audio" : "Play audio", systemImage: isPlaying ? "pause.fill" : "play.fill")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(SottoSecondaryButtonStyle())
            .disabled(audioURL == nil)
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .onDisappear {
            player?.pause()
            isPlaying = false
        }
    }

    private var listeningStatus: String {
        if episode == nil {
            return "Listening was not attached to this generated class."
        }
        return "Audio is still generating. The comprehension questions are available below."
    }

    private func togglePlayback() {
        guard let audioURL else { return }
        if player == nil {
            player = AVPlayer(url: audioURL)
        }
        if isPlaying {
            player?.pause()
            isPlaying = false
        } else {
            player?.play()
            isPlaying = true
        }
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
                    Color(red: 0.98, green: 0.95, blue: 0.88),
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

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 12) {
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
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], alignment: .leading, spacing: 8) {
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

            if let urlString = prompt.referenceTtsUrl, let url = URL(string: urlString) {
                Link(destination: url) {
                    Label("Reference voice", systemImage: "speaker.wave.2")
                }
                .font(.callout.bold())
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

            if let explanation = question.explanation, !explanation.isEmpty {
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

struct PromptBlock: View {
    let title: String
    let icon: String
    let prompts: [String]
    let onSelectionHelp: (String, String) -> Void

    init(
        title: String,
        icon: String,
        prompts: [String],
        onSelectionHelp: @escaping (String, String) -> Void = { _, _ in }
    ) {
        self.title = title
        self.icon = icon
        self.prompts = prompts
        self.onSelectionHelp = onSelectionHelp
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            ForEach(prompts, id: \.self) { prompt in
                SelectableLearnerText(
                    prompt,
                    font: LearnerTextFonts.body,
                    color: UIColor(SottoTheme.muted),
                    onExamples: onSelectionHelp
                )
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
