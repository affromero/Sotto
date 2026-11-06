import SwiftUI

struct VocabularyStudyPicker: View {
    @EnvironmentObject private var model: SottoAppModel
    @Environment(\.dismiss) private var dismiss
    let courseId: String
    let onAdmitted: (SottoPracticeStart) -> Void
    @State private var mode: SottoVocabularyMode = .meaning
    @State private var modeChosen = false
    @State private var selected: Set<String> = []
    @State private var pending: SottoVocabularyAdmission?
    @State private var busy = false
    @State private var error: String?
    @State private var pendingSessions: [String] = []
    @State private var unavailableSession: String?

    var body: some View {
        NavigationStack {
            Form {
                if !pendingSessions.isEmpty {
                    Section("Saved responses to check") {
                        ForEach(pendingSessions, id: \.self) { sessionId in
                            Button("Resume vocabulary study") { Task { await resume(sessionId) } }.disabled(busy)
                        }
                    }
                }
                Section("Practice mode") {
                    Picker("Practice mode", selection: $mode) {
                        ForEach(SottoVocabularyMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.inline)
                    .disabled(busy || pending != nil)
                    .onChange(of: mode) { _, _ in modeChosen = true }
                    Text("Swipe to rate flashcards. Your ratings update your review schedule.")
                        .font(.callout).foregroundStyle(SottoTheme.muted)
                }
                if let error { Text(error).foregroundStyle(.red) }
                Button(pending != nil ? "Retry saved attempt" : selected.isEmpty ? "Start practice" : "Practice selection (\(selected.count))") {
                    Task { await start() }
                }.disabled(busy)
                VocabularyDictionaryView(courseId: courseId, selected: $selected, mode: $mode, modeChosen: $modeChosen, disabled: busy || pending != nil) { session in
                    onAdmitted(session)
                    dismiss()
                }
            }
            .navigationTitle("Vocabulary")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) } }
            .interactiveDismissDisabled(busy)
            .task { restorePending() }
            .confirmationDialog("Remove saved local work?", isPresented: Binding(
                get: { unavailableSession != nil }, set: { if !$0 { unavailableSession = nil } }
            ), titleVisibility: .visible) {
                Button("Remove local work", role: .destructive) {
                    if let sessionId = unavailableSession { removeUnavailable(sessionId) }
                    unavailableSession = nil
                }
                Button("Keep local work", role: .cancel) { unavailableSession = nil }
            } message: { Text("This session is no longer available on the server. Removing its local response and draft cannot be undone.") }
        }
    }

    private func start() async {
        busy = true
        defer { busy = false }
        do {
            guard let client = model.makeClient() else { throw SottoAPIError.message("Pair this device to study vocabulary.") }
            let store = VocabularyPendingStore(client: client, scope: "admission/\(courseId)")
            let request = pending ?? SottoVocabularyAdmission(requestId: UUID().uuidString.lowercased(), mode: mode, wordIds: selected.isEmpty ? nil : selected.sorted())
            try store.save(request)
            pending = request
            guard let requestId = UUID(uuidString: request.requestId) else { throw SottoAPIError.message("The saved request identity is invalid.") }
            let response = try await model.startVocabularyStudy(courseId: courseId, mode: request.mode, requestId: requestId, wordIds: request.wordIds ?? [])
            try store.clear()
            pending = nil
            onAdmitted(response)
            dismiss()
        } catch let failure as SottoAPIError {
            if case let .http(status, _) = failure, [400, 409, 422].contains(status),
               let client = model.makeClient() {
                do { try VocabularyPendingStore(client: client, scope: "admission/\(courseId)").clear(); pending = nil }
                catch { self.error = error.localizedDescription; return }
            }
            error = failure.localizedDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restorePending() {
        guard let client = model.makeClient() else { return }
        do {
            pending = try VocabularyPendingStore(client: client, scope: "admission/\(courseId)").load(SottoVocabularyAdmission.self)
            pendingSessions = try VocabularyPendingStore(client: client, scope: "admission/\(courseId)").pendingSessions(courseId: courseId)
            if let pending { modeChosen = true; mode = pending.mode; selected = Set(pending.wordIds ?? []) }
        } catch { self.error = error.localizedDescription }
    }

    private func resume(_ sessionId: String) async {
        guard let client = model.makeClient() else { return }
        busy = true
        defer { busy = false }
        do {
            let session = try await client.fetchPractice(sessionId: sessionId)
            guard model.isCurrentLearningClient(client), session.isVocabularyStudy, session.courseId == courseId,
                  session.sessionId == sessionId, session.cards?.isEmpty == false else {
                throw SottoAPIError.message("This saved study is no longer available for this course.")
            }
            onAdmitted(session)
            dismiss()
        } catch let failure as SottoAPIError {
            if case .http(404, _) = failure { unavailableSession = sessionId }
            else { error = failure.localizedDescription }
        } catch { self.error = error.localizedDescription }
    }

    private func removeUnavailable(_ sessionId: String) {
        guard let client = model.makeClient() else { return }
        do {
            try VocabularyPendingStore(client: client, scope: "action/\(courseId)/\(sessionId)").clear()
            try VocabularyPendingStore(client: client, scope: "draft/\(courseId)/\(sessionId)").clear()
            pendingSessions.removeAll { $0 == sessionId }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
