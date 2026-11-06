import SwiftUI

struct VocabularyDictionaryView: View {
    @EnvironmentObject private var model: SottoAppModel
    let courseId: String
    @Binding var selected: Set<String>
    @Binding var mode: SottoVocabularyMode
    @Binding var modeChosen: Bool
    let disabled: Bool
    @State private var dictionary: SottoDictionary?
    @State private var search = ""
    @State private var filter = "all"
    @State private var page = 1
    @State private var refresh = 0
    @State private var editing: SottoDictionaryWord?
    @State private var error: String?
    @State private var busyMaterial: String?
    @State private var support = ""
    @State private var supportInitialized = false
    @State private var savingSupport = false

    var body: some View {
        Group {
            Section("Your dictionary") {
                if let dictionary {
                    Text("\(dictionary.total) words · \(dictionary.counts.due) due · \(dictionary.counts.unseen) unseen")
                        .font(.callout).foregroundStyle(SottoTheme.muted)
                }
                TextField("Find a word or meaning", text: $search).onChange(of: search) { _, _ in page = 1 }
                Picker("Show", selection: $filter) {
                    Text("All words").tag("all")
                    Text("Unseen").tag("unseen")
                    Text("Learning").tag("learning")
                    Text("Due").tag("due")
                    Text("Strong").tag("strong")
                }.onChange(of: filter) { _, _ in page = 1 }
                if !selected.isEmpty {
                    Button("Clear \(selected.count) selected words") { selected.removeAll() }.disabled(disabled)
                }
                if let dictionary {
                    if dictionary.words.isEmpty { Text("No words match this view.").foregroundStyle(SottoTheme.muted) }
                    ForEach(dictionary.words) { word in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Button {
                                    if selected.contains(word.id) { selected.remove(word.id) }
                                    else if selected.count < 24 { selected.insert(word.id) }
                                } label: {
                                    Image(systemName: selected.contains(word.id) ? "checkmark.circle.fill" : "circle")
                                        .frame(width: 44, height: 44)
                                }
                                .accessibilityLabel("Select \(word.lemma)")
                                .disabled(disabled || (!selected.contains(word.id) && selected.count >= 24))
                                VStack(alignment: .leading) {
                                    Text(word.lemma).font(.headline)
                                    Text(word.translation)
                                    Text(word.state.capitalized).font(.caption).foregroundStyle(SottoTheme.muted)
                                }
                            }
                            if let part = word.partOfSpeech { Text(part).font(.caption) }
                            VocabularyPronunciation(path: "/api/v1/courses/\(courseId)/vocabulary/\(word.id)/audio")
                            if word.lastReviewed != nil {
                                Text("Recall estimate \(Int((word.mastery * 100).rounded()))% · \(word.reviews) reviews")
                                    .font(.caption).foregroundStyle(SottoTheme.muted)
                            }
                            if !word.sources.isEmpty {
                                DisclosureGroup("\(word.sourceCount) source locations") {
                                    ForEach(Array(word.sources.enumerated()), id: \.offset) { _, source in
                                        Text("\(source.name): \(source.quote) · \(source.meaning)")
                                            .font(.caption)
                                    }
                                }
                            }
                            Button("Edit meanings") { editing = word }.disabled(disabled)
                        }
                    }
                    if dictionary.pages > 1 {
                        HStack {
                            Button("Previous") { page -= 1 }.disabled(page <= 1)
                            Spacer()
                            Text("\(page) / \(dictionary.pages)")
                            Spacer()
                            Button("Next") { page += 1 }.disabled(page >= dictionary.pages)
                        }
                    }
                } else if error == nil { ProgressView("Loading dictionary") }
                if let error { Text(error).foregroundStyle(.red) }
            }
            if let dictionary, !dictionary.materials.isEmpty {
                Section("Words from your materials") {
                    ForEach(dictionary.materials) { material in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(material.name).font(.headline)
                            Text(material.status.replacingOccurrences(of: "_", with: " ").capitalized)
                            if material.totalChunks > 0 {
                                Text("\(material.processedChunks) / \(material.totalChunks) sections · \(material.entries) entries").font(.caption)
                            }
                            if let failure = material.error { Text(failure).foregroundStyle(.red) }
                            if ["NOT_INDEXED", "FAILED", "UNRESOLVED"].contains(material.status) {
                                Button(material.status == "NOT_INDEXED" ? "Index all vocabulary" : "Retry unfinished sections") {
                                    Task { await index(material) }
                                }.disabled(disabled || busyMaterial != nil)
                            }
                        }
                    }
                }
            }
            if dictionary != nil {
                Section("Vocabulary support") {
                    Picker("What makes vocabulary difficult?", selection: $support) {
                        Text("I’m not sure yet").tag("")
                        Text("Remembering meanings").tag("MEANING_RECALL")
                        Text("Finding words").tag("WORD_RECALL")
                        Text("Recognizing words by sound").tag("LISTENING_RECOGNITION")
                    }
                    Button("Save vocabulary support") { Task { await saveSupport() } }
                        .disabled(disabled || savingSupport || support == (dictionary?.vocabularySupport ?? ""))
                }
            }
        }
        .task(id: "\(search)/\(filter)/\(page)/\(refresh)") { await load() }
        .sheet(item: $editing) { word in
            VocabularyMeaningEditor(courseId: courseId, word: word) { refresh += 1 }
                .environmentObject(model)
        }
    }

    private func load() async {
        guard let client = model.makeClient() else { return }
        do {
            if !search.isEmpty { try await Task.sleep(for: .milliseconds(200)) }
            repeat {
                let result = try await client.vocabularyDictionary(courseId: courseId, search: String(search.prefix(100)), state: filter, page: page)
                guard !Task.isCancelled, model.isCurrentLearningClient(client) else { return }
                dictionary = result
                if !supportInitialized {
                    support = result.vocabularySupport ?? ""
                    if !modeChosen {
                        if support == "WORD_RECALL" { mode = .word }
                        else if support == "LISTENING_RECOGNITION" { mode = .listening }
                    }
                    supportInitialized = true
                }
                error = nil
                guard result.materials.contains(where: { ["PENDING", "ACTIVE"].contains($0.status) }) else { return }
                try await Task.sleep(for: .seconds(4))
            } while !Task.isCancelled
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }

    private func index(_ material: SottoVocabularyImport) async {
        guard let client = model.makeClient() else { return }
        busyMaterial = material.id
        defer { busyMaterial = nil }
        do {
            try await client.indexVocabulary(materialId: material.id, retry: material.status != "NOT_INDEXED")
            guard model.isCurrentLearningClient(client) else { return }
            error = nil
            refresh += 1
        } catch { self.error = error.localizedDescription }
    }

    private func saveSupport() async {
        guard let client = model.makeClient() else { return }
        savingSupport = true
        defer { savingSupport = false }
        do {
            try await client.saveVocabularySupport(courseId: courseId, support: support.isEmpty ? nil : support)
            guard model.isCurrentLearningClient(client) else { return }
            error = nil
            refresh += 1
        } catch { self.error = error.localizedDescription }
    }
}

private struct VocabularyMeaningEditor: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let courseId: String
    let word: SottoDictionaryWord
    let onSave: () -> Void
    @State private var meaning = ""
    @State private var aliases = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Text("These meanings apply to future recall sessions.")
                TextField("Primary meaning", text: $meaning)
                TextField("Other meanings, one per line", text: $aliases, axis: .vertical).lineLimit(3...8)
                if let error { Text(error).foregroundStyle(.red) }
                Button("Save meanings") { Task { await save() } }
                    .disabled(busy || meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .navigationTitle(word.lemma)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
            .onAppear { meaning = word.translation; aliases = word.acceptedMeanings.joined(separator: "\n") }
        }
    }

    private func save() async {
        guard let client = model.makeClient() else { return }
        busy = true
        defer { busy = false }
        do {
            let values = aliases.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            try await client.saveVocabularyMeaning(courseId: courseId, wordId: word.id,
                meaning: SottoVocabularyMeaning(translation: meaning.trimmingCharacters(in: .whitespacesAndNewlines), acceptedMeanings: values))
            guard model.isCurrentLearningClient(client) else { return }
            onSave()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
