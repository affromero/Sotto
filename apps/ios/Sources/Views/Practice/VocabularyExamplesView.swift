import SwiftUI

struct VocabularyExamplesView: View {
    @EnvironmentObject private var model: SottoAppModel
    let sessionId: String
    let cardId: String
    let revealed: Bool
    @State private var open = false
    @State private var busy = false
    @State private var result: SottoVocabularyExamplesResponse?
    @State private var error: String?
    @State private var task: Task<Void, Never>?
    @State private var requestVersion = 0

    private var path: String { "/api/v1/practice/\(sessionId)/vocabulary/\(cardId)/examples" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !open {
                Button("See two examples") { open = true; check() }
                    .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
            } else {
                Text("In context").font(.headline).foregroundStyle(SottoTheme.ink)
                if busy { ProgressView("Preparing examples…") }
                if let examples = result?.examples {
                    ForEach(Array(examples.enumerated()), id: \.offset) { _, example in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(example.sentence).foregroundStyle(SottoTheme.ink)
                            if let translation = example.translation { Text(translation).foregroundStyle(SottoTheme.muted) }
                        }
                    }
                }
                if let error { Text(error).font(.callout).foregroundStyle(SottoTheme.rose) }
                if result?.status == "FAILED", let message = result?.error {
                    Text(message).font(.callout).foregroundStyle(SottoTheme.rose)
                }
                if !busy && (error != nil || (result?.status == "FAILED" && result?.canRetry == true)) {
                    Button(error != nil ? "Check examples" : "Try again") { check(retry: error == nil) }
                        .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
                }
            }
        }
        .onChange(of: revealed) { _, _ in if open { check() } }
        .onDisappear { requestVersion += 1; task?.cancel() }
    }

    private func check(retry: Bool = false) {
        task?.cancel()
        requestVersion += 1
        let version = requestVersion
        task = Task {
            guard let client = model.makeClient() else { error = "Pair this device to load examples."; return }
            busy = true
            defer { if requestVersion == version { busy = false } }
            do {
                var value = try await client.vocabularyExamples(path: path)
                if value.status == "AVAILABLE" || (retry && value.status == "FAILED" && value.canRetry) {
                    value = try await client.prepareVocabularyExamples(path: path, request: value.request)
                }
                var polls = 0
                while value.status == "PENDING" && polls < 180 {
                    try await Task.sleep(for: .seconds(2))
                    value = try await client.vocabularyExamples(path: path)
                    polls += 1
                }
                if value.status == "PENDING" { throw SottoAPIError.message("Examples are still preparing. Check their status again.") }
                guard !Task.isCancelled, model.isCurrentLearningClient(client) else { return }
                result = value
                error = nil
            } catch {
                if !Task.isCancelled { self.error = error.localizedDescription }
            }
        }
    }
}
