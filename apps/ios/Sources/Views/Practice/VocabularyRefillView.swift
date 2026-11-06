import SwiftUI

struct VocabularyRefillView: View {
    @EnvironmentObject private var model: SottoAppModel
    let courseId: String
    let sessionId: String?
    let onContinue: (SottoPracticeStart) -> Void
    @State private var result: SottoVocabularyRefillResponse?
    @State private var busy = false
    @State private var error: String?
    @State private var task: Task<Void, Never>?
    @State private var requestVersion = 0

    var body: some View {
        Group {
            if result?.status != "NOT_NEEDED" || error != nil {
                VStack(alignment: .leading, spacing: 10) {
                    Text("More words").font(.headline).foregroundStyle(SottoTheme.ink)
                    if busy { ProgressView("Preparing new words…") }
                    if let result, result.status == "READY" {
                        Text(result.added == 0 ? "More words are ready." : "\(result.added ?? 0) new words are ready.")
                        Button("Continue with new words") { startContinuation(result) }
                            .buttonStyle(.borderedProminent).tint(SottoTheme.primary).controlSize(.large)
                            .disabled(busy || result.nextSessionId == nil || result.wordIds?.isEmpty != false)
                    }
                    if let result, result.status == "FAILED", let message = result.error {
                        Text(message).font(.callout).foregroundStyle(SottoTheme.rose)
                    }
                    if let error { Text(error).font(.callout).foregroundStyle(SottoTheme.rose) }
                    if !busy && (error != nil || (result?.status == "FAILED" && result?.canRetry == true)) {
                        Button(error != nil ? "Check new words" : "Try again") { check(retry: error == nil) }
                            .buttonStyle(.bordered).tint(SottoTheme.primary).controlSize(.large)
                    }
                }
            }
        }
        .task { check() }
        .onDisappear { requestVersion += 1; task?.cancel() }
    }

    private func check(retry: Bool = false) {
        task?.cancel()
        requestVersion += 1
        let version = requestVersion
        task = Task {
            guard let client = model.makeClient() else { error = "Pair this device to prepare new words."; return }
            busy = true
            defer { if requestVersion == version { busy = false } }
            do {
                var value = try await client.vocabularyRefill(courseId: courseId, sessionId: sessionId)
                if value.status == "AVAILABLE" || (retry && value.status == "FAILED" && value.canRetry) {
                    guard let request = value.request else { throw SottoAPIError.message("The refill request could not be verified.") }
                    value = try await client.prepareVocabularyRefill(courseId: courseId, request: request)
                }
                var polls = 0
                while value.status == "PENDING" && polls < 180 {
                    try await Task.sleep(for: .seconds(2))
                    value = try await client.vocabularyRefill(courseId: courseId, sessionId: sessionId)
                    polls += 1
                }
                if value.status == "PENDING" { throw SottoAPIError.message("New words are still preparing. Check their status again.") }
                if value.status == "READY" && (value.nextSessionId == nil || value.wordIds?.isEmpty != false) {
                    throw SottoAPIError.message("The new words could not be verified.")
                }
                guard !Task.isCancelled, model.isCurrentLearningClient(client) else { return }
                result = value
                error = nil
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }

    private func startContinuation(_ value: SottoVocabularyRefillResponse) {
        guard let id = value.nextSessionId.flatMap(UUID.init(uuidString:)), let wordIds = value.wordIds, !wordIds.isEmpty else { return }
        task?.cancel()
        requestVersion += 1
        let version = requestVersion
        task = Task {
            busy = true
            defer { if requestVersion == version { busy = false } }
            do {
                let session = try await model.startVocabularyStudy(courseId: courseId, mode: .flashcards, requestId: id, wordIds: wordIds)
                if !Task.isCancelled && requestVersion == version { onContinue(session) }
            } catch { if !Task.isCancelled && requestVersion == version { self.error = error.localizedDescription } }
        }
    }
}
