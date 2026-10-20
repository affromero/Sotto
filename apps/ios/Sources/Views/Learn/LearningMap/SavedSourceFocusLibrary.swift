import SwiftUI

struct SavedSourceFocusLibrary: View {
    @EnvironmentObject private var model: SottoAppModel
    let courseId: String
    let target: String
    let level: SottoLearningLevel
    let previewOnly: Bool
    let onChoose: (SottoLearningSelection) -> Void
    let selectedObjectiveCount: Int
    let onCombine: ((SottoLearningSelection) -> Void)?
    @State private var analyses: SottoSavedSourceAnalyses?
    @State private var selected: SottoSavedSourceAnalyses.Item?
    @State private var focuses: SottoSavedSourceFocuses?
    @State private var detail: SottoSavedSourceFocusDetail?
    @State private var selectedFocus: SottoSavedSourceFocuses.Focus?
    @State private var busy = false
    @State private var error = ""
    @State private var epoch = UUID()

    init(courseId: String, target: String, level: SottoLearningLevel, previewOnly: Bool,
        selectedObjectiveCount: Int = 0, onCombine: ((SottoLearningSelection) -> Void)? = nil,
        onChoose: @escaping (SottoLearningSelection) -> Void) {
        self.courseId = courseId; self.target = target; self.level = level
        self.previewOnly = previewOnly; self.selectedObjectiveCount = selectedObjectiveCount
        self.onCombine = onCombine; self.onChoose = onChoose
    }

    var body: some View {
        DisclosureGroup("Saved source focuses") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Source exposure does not count as demonstrated mastery. Private focuses can be practised independently.").font(.caption)
                Button("Open saved analyses") { loadAnalyses(cursor: nil) }.frame(minHeight: 44).disabled(busy)
                if busy { ProgressView("Opening saved source receipt") }
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                if let analyses {
                    ForEach(analyses.items) { analysis in
                        Button("\(analysis.sourceNames.joined(separator: ", ")) · \(analysis.status.lowercased()) (\(analysis.focusCount) focuses)") {
                            loadFocuses(analysis, cursor: nil)
                        }.frame(minHeight: 44).disabled(busy)
                    }
                    if let next = analyses.nextCursor {
                        Button("Next analyses") { loadAnalyses(cursor: next) }.frame(minHeight: 44).disabled(busy)
                    }
                    if analyses.items.isEmpty { Text("No saved source analyses. Add and analyze originals on the web app.") }
                }
                if let focuses, let selected {
                    Text("Analysis revision \(focuses.analysisRevision)").font(.caption.monospaced())
                    ForEach(focuses.focuses) { focus in
                        Button(focus.title) { loadDetail(selected, focus) }.frame(minHeight: 44).disabled(busy)
                    }
                    if let next = focuses.nextCursor {
                        Button("Next source focuses") { loadFocuses(selected, cursor: next) }.frame(minHeight: 44).disabled(busy)
                    }
                }
                if let detail, let selectedFocus {
                    Text(detail.focus.title).font(.headline)
                    if detail.focus.privateExtension { Text("Private extension. No canonical objective credit.").font(.caption) }
                    if detail.focus.uncertainSource { Text("Some source interpretation is uncertain. Review the exact cited text.").font(.caption) }
                    ForEach(Array(detail.focus.citations.enumerated()), id: \.offset) { _, citation in
                        Text("Page \(citation.pageNumber), \(citation.origin.lowercased()), characters \(citation.codePointStart) to \(citation.codePointEnd)").font(.caption)
                        Text(citation.quote).textSelection(.enabled)
                    }
                    Button("Review private practice at \(level.rawValue)") {
                        onChoose(SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: level, materialFocusId: selectedFocus.id))
                    }.buttonStyle(.bordered).frame(minHeight: 44).disabled(busy || previewOnly)
                    if selectedObjectiveCount > 0, let onCombine {
                        Button("Review source with \(selectedObjectiveCount) selected objectives at \(level.rawValue)") {
                            onCombine(SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: level, materialFocusId: selectedFocus.id))
                        }.buttonStyle(.bordered).frame(minHeight: 44).disabled(busy || previewOnly)
                    }
                }
            }
        }
        .onChange(of: level) { _, _ in epoch = UUID(); busy = false; detail = nil; selectedFocus = nil }
        .onDisappear { epoch = UUID() }
    }

    private func loadAnalyses(cursor: String?) {
        let token = UUID(); epoch = token; busy = true; error = ""; focuses = nil; detail = nil; selectedFocus = nil
        Task {
            defer { if epoch == token { busy = false } }
            do {
                let result = try await model.savedSourceAnalyses(courseId: courseId, cursor: cursor)
                if epoch == token { analyses = result }
            } catch { if epoch == token { self.error = error.localizedDescription } }
        }
    }
    private func loadFocuses(_ analysis: SottoSavedSourceAnalyses.Item, cursor: String?) {
        let token = UUID(); epoch = token; busy = true; error = ""; focuses = nil; detail = nil; selectedFocus = nil
        Task {
            defer { if epoch == token { busy = false } }
            do {
                let result = try await model.savedSourceFocuses(courseId: courseId, target: target, analysis: analysis, afterOrder: cursor)
                if epoch == token { focuses = result; selected = analysis }
            } catch { if epoch == token { self.error = error.localizedDescription } }
        }
    }
    private func loadDetail(_ analysis: SottoSavedSourceAnalyses.Item, _ focus: SottoSavedSourceFocuses.Focus) {
        let token = UUID(); epoch = token; busy = true; error = ""; detail = nil; selectedFocus = nil
        Task {
            defer { if epoch == token { busy = false } }
            do {
                let result = try await model.savedSourceFocusDetail(analysis: analysis, focus: focus)
                if epoch == token { detail = result; selectedFocus = focus }
            } catch { if epoch == token { self.error = error.localizedDescription } }
        }
    }
}
