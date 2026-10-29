import SwiftUI

struct ClassLanguageHelpSheet: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let classId: String
    let teaching: SottoClassTeaching

    @State private var result: SottoClassLessonHelpResponse?
    @State private var failure: String?
    @State private var busy = false
    @State private var retry = false
    @State private var reload = 0

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if busy {
                        ProgressView("Preparing your language help")
                    } else if let message = failure ?? (result?.status == .failed ? result?.error : nil) {
                        Text(message).foregroundStyle(SottoTheme.ink)
                        Button(result?.canRetry == true ? "Retry language help" : "Check saved status") {
                            retry = result?.canRetry == true
                            reload += 1
                        }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                    } else if let help = result?.help, result?.status == .ready {
                        helpContent(help)
                    }
                }
                .frame(maxWidth: 760, alignment: .leading)
                .padding(20)
            }
            .background(SottoTheme.paper)
            .navigationTitle("Language help")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Back to lesson") { dismiss() } }
        }
        .task(id: reload) { await load(retry: retry, generation: reload) }
    }

    @MainActor private func load(retry: Bool, generation: Int) async {
        busy = true
        failure = nil
        result = nil
        defer { if generation == reload { busy = false } }
        do {
            let loader = ClassLessonHelpLoader(
                teaching: teaching,
                read: { try await model.fetchClassLessonHelp(classId: classId) },
                start: { try await model.startClassLessonHelp(classId: classId, request: $0) }
            )
            _ = try await loader.load(retry: retry) { value in
                if generation == reload { result = value }
            }
        } catch {
            if !Task.isCancelled && generation == reload { failure = error.localizedDescription }
        }
    }

    private func helpContent(_ help: SottoClassLessonHelp) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(help.title).font(.system(.title2, design: .serif).bold())
            Text(help.explanation)
            Text("Worked examples").font(.headline).foregroundStyle(SottoTheme.primary)
            ForEach(Array(help.workedExamples.enumerated()), id: \.offset) { index, example in
                VStack(alignment: .leading, spacing: 8) {
                    Text(example.prompt)
                    Text(teaching.workedExamples[index].answer).foregroundStyle(SottoTheme.primary)
                    Text(example.meaning)
                    Text(example.explanation)
                }
            }
            Text("Compare the sentences").font(.headline).foregroundStyle(SottoTheme.primary)
            Text(teaching.commonMistake.incorrect)
            Text(teaching.commonMistake.correction).foregroundStyle(SottoTheme.primary)
            Text(help.correctionExplanation)
            Text("Try it first").font(.headline).foregroundStyle(SottoTheme.primary)
            Text(teaching.guidedPractice.prompt).foregroundStyle(SottoTheme.primary)
            Text(help.guidedPrompt)
            Text(help.guidedHint)
        }
        .foregroundStyle(SottoTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
