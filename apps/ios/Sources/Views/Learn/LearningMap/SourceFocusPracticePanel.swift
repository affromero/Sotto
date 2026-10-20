import SwiftUI

struct SourceFocusPracticePanel: View {
    @EnvironmentObject private var model: SottoAppModel
    let courseId: String
    let target: String
    let level: SottoLearningLevel
    @State private var preview: SottoLearningSelectionPreview?
    @State private var kind = "FULL"
    @State private var busy = false
    @State private var error = ""
    @State private var epoch = UUID()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SavedSourceFocusLibrary(courseId: courseId, target: target, level: level, previewOnly: false) { selection in
                resolve(selection)
            }.environmentObject(model).disabled(busy)
            if busy { ProgressView("Checking private practice") }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            if let preview {
                Text("Private source practice at \(preview.selection.level.rawValue). No canonical objective credit.").font(.callout)
                Picker("Private practice format", selection: $kind) {
                    ForEach(preview.availableKinds, id: \.self) { Text($0.capitalized).tag($0) }
                }.frame(minHeight: 44)
                Button("Start private source practice") {
                    busy = true; error = ""
                    Task {
                        await model.startPractice(courseId: courseId, kind: kind, learningSelection: preview.explicitSelection())
                        busy = false
                        if let message = model.errorMessage { error = message }
                    }
                }.buttonStyle(.bordered).frame(minHeight: 44).disabled(busy)
            }
        }
        .onChange(of: level) { _, _ in epoch = UUID(); preview = nil; busy = false }
        .onDisappear { epoch = UUID() }
    }

    private func resolve(_ selection: SottoLearningSelection) {
        let token = UUID(); epoch = token; busy = true; error = ""; preview = nil
        Task {
            defer { if epoch == token { busy = false } }
            do {
                let value = try await model.previewLearningSelection(courseId: courseId, selection: selection)
                guard epoch == token else { return }
                guard value.selection.targetLang == target, value.selection.objectives.isEmpty,
                      value.selection.level == level else { throw SottoAPIError.message("The private focus changed its language or difficulty.") }
                preview = value; kind = value.availableKinds.contains("FULL") ? "FULL" : value.availableKinds[0]
            } catch { if epoch == token { self.error = error.localizedDescription } }
        }
    }
}
