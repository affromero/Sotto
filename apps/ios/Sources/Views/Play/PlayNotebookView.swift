import SwiftUI

struct PlayPhraseCapture: View {
    @ObservedObject var coordinator: PlayCoordinator
    let round: PlayRound
    @State private var context = ""
    @State private var text = ""
    @State private var kind: PlayPhraseKind = .phrase
    var body: some View {
        DisclosureGroup("Keep a word or sentence") {
            VStack(alignment: .leading, spacing: 14) {
                Text("Only you can see your notebook.").font(.caption).foregroundStyle(SottoTheme.muted)
                Picker("From this round", selection: $context) {
                    Text("Choose game text").tag("")
                    ForEach(round.visibleTexts, id: \.self) { Text($0).tag($0) }
                }
                TextField("Word or sentence to keep", text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...4)
                Picker("Save as", selection: $kind) {
                    ForEach(PlayPhraseKind.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                Button("Save privately") {
                    coordinator.run { try await coordinator.keep(text: text, context: context, kind: kind, round: round) }
                }.buttonStyle(SottoSecondaryButtonStyle())
                    .disabled(coordinator.busy || coordinator.state?.pending != nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(.top, 12)
        }.onChange(of: context) { _, value in text = value }
    }
}

struct PlayNotebookView: View {
    @ObservedObject var coordinator: PlayCoordinator
    @State private var courses: [SottoCourse]?
    @State private var chosen: [String: String] = [:]
    @State private var saved: [String: String] = [:]
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Your phrase notebook").font(.system(.largeTitle, design: .serif))
            Text("Words and sentences you chose to keep. Only you can see these.").foregroundStyle(SottoTheme.muted)
            Button("Refresh notebook") { coordinator.run { try await coordinator.loadPhrases() } }
                .buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.busy)
            if coordinator.phrases.isEmpty { Text("Keep a word during a game. It will be here when you return.") }
            ForEach(coordinator.phrases) { phrase in
                VStack(alignment: .leading, spacing: 12) {
                    Text("\(phrase.targetLang.uppercased()) · \(phrase.kind.rawValue.lowercased())")
                        .font(.caption.monospaced()).foregroundStyle(SottoTheme.muted)
                    Text(phrase.text).font(.title3).textSelection(.enabled)
                    if let context = phrase.contextText, context != phrase.text { Text(context).foregroundStyle(SottoTheme.muted) }
                    DisclosureGroup("Add to study") {
                        if let courses {
                            let matching = courses.filter { $0.targetLang == phrase.targetLang }
                            if matching.isEmpty {
                                Text("Create a course in this language to add this to study. Your notebook is already saved.")
                            } else {
                                Picker("Choose your course", selection: selection(phrase.id)) {
                                    Text("Choose a course").tag("")
                                    ForEach(matching) { course in
                                        Text("\(course.curriculum?.title ?? course.targetLang.uppercased()) · \(course.currentLevel)").tag(course.id)
                                    }
                                }
                                if let course = matching.first(where: { $0.id == chosen[phrase.id] }) {
                                    Button(saved[phrase.id] == course.id ? "Added to study" : "Add to this course") {
                                        coordinator.run {
                                            try await coordinator.addToStudy(phrase, course: course)
                                            saved[phrase.id] = course.id
                                        }
                                    }.buttonStyle(SottoSecondaryButtonStyle())
                                        .disabled(coordinator.busy || saved[phrase.id] == course.id)
                                }
                            }
                        } else {
                            Button("Load my courses") {
                                coordinator.run { courses = try await coordinator.studyCourses() }
                            }.frame(minHeight: 44).disabled(coordinator.busy)
                        }
                    }
                }
                Divider()
            }
            if coordinator.phrasesCursor != nil {
                Button("Older phrases") { coordinator.run { try await coordinator.loadPhrases(older: true) } }
                    .buttonStyle(SottoSecondaryButtonStyle()).disabled(coordinator.busy)
            }
        }
    }
    private func selection(_ id: String) -> Binding<String> {
        Binding(get: { chosen[id] ?? "" }, set: { chosen[id] = $0 })
    }
}
