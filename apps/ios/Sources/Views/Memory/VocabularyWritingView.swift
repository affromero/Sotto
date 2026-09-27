import SwiftUI

struct VocabularyWritingView: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let words: [SottoMemoryNode]
    let courseID: String
    @State private var index = 0
    @State private var answer = ""
    @State private var isRevealed = false
    @State private var showsHandwriting = false

    var body: some View {
        NavigationStack {
            if words.indices.contains(index) {
                let word = words[index]
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Word \(index + 1) of \(words.count)").font(.caption.monospaced())
                        Text(word.translation ?? "Write this word from memory")
                            .font(.largeTitle).fixedSize(horizontal: false, vertical: true)
                        Text("Recall the word, write it with Apple Pencil, then compare your spelling.")
                            .foregroundStyle(SottoTheme.muted)
                        Button("Write from memory", systemImage: "pencil.tip") { showsHandwriting = true }
                            .buttonStyle(SottoPrimaryButtonStyle())
                        TextField("Your answer", text: $answer)
                            .textFieldStyle(.roundedBorder).autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .accessibilityLabel("Your vocabulary answer")
                        Button("Check spelling", systemImage: "checkmark.circle") { isRevealed = true }
                            .buttonStyle(.bordered).controlSize(.large)
                            .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        if isRevealed {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(VocabularySpelling.matches(answer, word.label) ? "Spelling matches" : "Compare your spelling")
                                    .font(.headline)
                                Text(word.label).font(.title).textSelection(.enabled)
                                if let pronunciation = word.pronunciation { Text(pronunciation).foregroundStyle(SottoTheme.muted) }
                                Text("Your answer: \(answer)")
                            }
                            Button(index + 1 == words.count ? "Finish practice" : "Next word", systemImage: "arrow.right") {
                                index += 1
                                answer = ""
                                isRevealed = false
                            }
                            .buttonStyle(SottoPrimaryButtonStyle())
                        }
                        Text("This is private spelling practice on this device. Use Review in Memory to update your spaced-repetition progress.")
                            .font(.caption).foregroundStyle(SottoTheme.muted)
                    }
                    .padding(24)
                }
                .background(SottoTheme.paper)
                .navigationTitle("Vocabulary handwriting")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                .sheet(isPresented: $showsHandwriting) {
                    if let credentials = model.credentials, let profile = credentials.selectedProfile {
                        HandwritingView(
                            title: word.translation ?? "Write the word from memory",
                            storageKey: LearningInkStore.scope(server: credentials.serverURL, profileID: profile.id, activity: "vocabulary/\(courseID)/\(word.id)")
                        ) { text in
                            answer = text
                            isRevealed = false
                        }
                    }
                }
            } else {
                ContentUnavailableView {
                    Label("Practice complete", systemImage: "checkmark.circle")
                } description: {
                    Text("You practiced \(words.count) words. Return to Memory whenever you want another writing session.")
                } actions: {
                    Button("Done") { dismiss() }.buttonStyle(.borderedProminent)
                }
            }
        }
    }
}

enum VocabularySpelling {
    static func matches(_ answer: String, _ expected: String) -> Bool {
        answer.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping.lowercased()
            == expected.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping.lowercased()
    }
}
