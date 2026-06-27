import SwiftUI

struct ClassSessionView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let classDetail: SottoClassDetail

    @State private var answers: [String: Int] = [:]

    private var currentClass: SottoClassDetail {
        model.selectedClass ?? classDetail
    }

    private var questions: [SottoQuestion] {
        currentClass.sections.flatMap(\.questions)
    }

    private var allAnswered: Bool {
        !questions.isEmpty && questions.allSatisfy { answers[$0.id] != nil }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    header

                    if let result = model.classResult {
                        ClassResultBanner(result: result)
                    }

                    ForEach(currentClass.sections) { section in
                        ClassSectionView(section: section, answers: $answers)
                    }
                }
                .padding(28)
                .frame(maxWidth: 980, alignment: .leading)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Class \(currentClass.order)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        dismiss()
                    }
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        let classId = currentClass.id
                        Task {
                            await model.openWorkbook(for: classId)
                        }
                    } label: {
                        Label("Workbook", systemImage: "pencil.and.scribble")
                    }

                    Button {
                        Task {
                            let payload = answers.map { SottoSubmitAnswer(questionId: $0.key, selectedIndex: $0.value) }
                            await model.submitClassAnswers(payload)
                        }
                    } label: {
                        Label("Submit", systemImage: "checkmark.circle.fill")
                    }
                    .disabled(!allAnswered)
                }
            }
            .overlay {
                if model.isLoading {
                    LoadingOverlay(operation: model.loadingOperation)
                }
            }
            .sheet(isPresented: workbookSheetBinding) {
                if let workbook = model.workbook {
                    WorkbookView(response: workbook)
                }
            }
        }
    }

    private var workbookSheetBinding: Binding<Bool> {
        Binding {
            model.workbook != nil
        } set: { isPresented in
            if !isPresented {
                model.workbook = nil
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(currentClass.lesson?.title ?? "Sotto class")
                    .font(.system(size: 40, weight: .bold, design: .serif))
                    .foregroundStyle(SottoTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                if let objective = currentClass.lesson?.objective, !objective.isEmpty {
                    Text(objective)
                        .font(.title3)
                        .foregroundStyle(SottoTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 10) {
                Label(currentClass.status.capitalized, systemImage: "flag.checkered")
                Text("\(answers.count) of \(questions.count) answered")
                if let sourceTitle = currentClass.sourceTitle {
                    Text(sourceTitle)
                        .lineLimit(1)
                }
            }
            .font(.callout)
            .foregroundStyle(SottoTheme.muted)
        }
    }
}

private struct ClassSectionView: View {
    let section: SottoClassSection
    @Binding var answers: [String: Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(section.skill.capitalized)
                        .font(.title2.bold())
                        .foregroundStyle(SottoTheme.ink)
                    Text(section.status.capitalized)
                        .font(.callout)
                        .foregroundStyle(SottoTheme.muted)
                }
                Spacer()
                if let score = section.score {
                    Text("\(Int(score * 100))%")
                        .font(.headline)
                        .foregroundStyle(section.passed == true ? SottoTheme.success : SottoTheme.primary)
                }
            }

            if let episode = section.episode, let audioUrl = episode.audioUrl, let url = URL(string: audioUrl) {
                Link(destination: url) {
                    Label(episode.title, systemImage: "play.circle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(SottoSecondaryButtonStyle())
            }

            ForEach(section.questions.sorted { $0.order < $1.order }) { question in
                QuestionView(question: question, selectedIndex: answers[question.id]) { selected in
                    answers[question.id] = selected
                }
            }

            if !section.prompts.isEmpty {
                PromptBlock(title: "Speaking", icon: "waveform", prompts: section.prompts.map {
                    "\($0.targetPhrase) - \($0.translation)"
                })
            }

            if !section.writingPrompts.isEmpty {
                PromptBlock(title: "Writing", icon: "square.and.pencil", prompts: section.writingPrompts.map(\.task))
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

private struct QuestionView: View {
    let question: SottoQuestion
    let selectedIndex: Int?
    let onSelect: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let passage = question.passageText, !passage.isEmpty {
                Text(passage)
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SottoTheme.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            Text(question.question)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

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
                Text(explanation)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }
        }
    }
}

struct PromptBlock: View {
    let title: String
    let icon: String
    let prompts: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            ForEach(prompts, id: \.self) { prompt in
                Text(prompt)
                    .font(.body)
                    .foregroundStyle(SottoTheme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct ClassResultBanner: View {
    let result: SottoClassSubmitResult

    var body: some View {
        HStack(spacing: 18) {
            Image(systemName: result.passed ? "checkmark.seal.fill" : "exclamationmark.arrow.triangle.2.circlepath")
                .font(.system(size: 42))
                .foregroundStyle(result.passed ? SottoTheme.success : SottoTheme.primary)

            VStack(alignment: .leading, spacing: 4) {
                Text(result.passed ? "Class passed" : "Review needed")
                    .font(.title2.bold())
                    .foregroundStyle(SottoTheme.ink)
                Text("\(Int(result.overallScore * 100))% overall, \(result.passedSections) of \(result.totalSections) sections passed.")
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
