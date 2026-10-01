import Foundation

@MainActor
final class NativeLearningSessionState {
    let progress = LearningProgressStore()
    let drafts = WritingDraftStore()
    var speaking: [String: NativeSpeakingState] = [:]
}

extension SottoAppModel {
    func speakingState(source: SpeakingPromptSource, promptId: String) -> NativeSpeakingState {
        let attempt: Int
        if case let .classSession(id) = source, selectedClass?.id == id { attempt = selectedClass?.attempt ?? 1 }
        else { attempt = 1 }
        let state = learningSessionState(path: source.path, attempt: attempt, revision: 0)
        if let saved = state.speaking[promptId] { return saved }
        let saved = NativeSpeakingState()
        state.speaking[promptId] = saved
        return saved
    }

    func latestWritingPrompt(source: WritingPromptSource, promptId: String) async throws -> SottoWritingPrompt? {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to check writing feedback.") }
        let prompt: SottoWritingPrompt?
        switch source {
        case let .classSession(id):
            prompt = try await client.fetchClass(classId: id).sections.flatMap(\.writingPrompts).first { $0.id == promptId }
        case let .practice(id):
            prompt = try await client.fetchPractice(sessionId: id).writingPrompts?.first { $0.id == promptId }
        case let .exam(id):
            prompt = try await client.fetchExam(examId: id).sections.flatMap(\.writingPrompts).first { $0.id == promptId }
        }
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return prompt
    }

    func latestSpeakingRecording(source: SpeakingPromptSource, promptId: String) async throws -> SottoSpeakingRecording? {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to check your recording.") }
        let recording: SottoSpeakingRecording?
        switch source {
        case let .classSession(id):
            recording = try await client.fetchClass(classId: id).sections.flatMap(\.prompts).first { $0.id == promptId }?.latestRecording
        case let .practice(id):
            recording = try await client.fetchPractice(sessionId: id).speakingPrompts?.first { $0.id == promptId }?.latestRecording
        case let .exam(id):
            recording = try await client.fetchExam(examId: id).sections.flatMap(\.speakingPrompts).first { $0.id == promptId }?.latestRecording
        }
        guard isCurrentLearningClient(client) else { throw CancellationError() }
        return recording
    }

    func isCurrentLearningClient(_ client: SottoAPIClient) -> Bool {
        guard let current = makeClient() else { return false }
        return current.serverURL == client.serverURL && current.profileId == client.profileId
    }

    func learningSessionState(path: String, attempt: Int, revision: Int) -> NativeLearningSessionState {
        let client = makeClient()
        let key = "\(client?.serverURL.absoluteString ?? "")/\(client?.profileId ?? "")/\(path)/\(attempt)"
        if let state = learningSessions[key] { return state }
        let state = NativeLearningSessionState()
        state.progress.configure(client: client, path: path, revision: revision)
        learningSessions[key] = state
        return state
    }

    func startPractice(courseId: String, kind: String) async {
        guard let client = makeClient() else { return }
        let key = "\(client.serverURL.absoluteString)/\(client.profileId ?? "")/\(courseId)/\(kind)"
        let requestId = pendingPracticeAdmissions[key] ?? UUID()
        pendingPracticeAdmissions[key] = requestId
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let response = try await client.startPractice(courseId: courseId, kind: kind, requestId: requestId)
            guard isCurrentLearningClient(client) else { return }
            practiceStart = response
            practiceResult = response.submissionResult
            clearSettledPracticeAdmission(response, client: client)
        } catch { report(error) }
    }

    private func clearSettledPracticeAdmission(_ response: SottoPracticeStart, client: SottoAPIClient) {
        guard response.status != "preparing" || ["CANCELLED", "FAILED"].contains(response.preparationStatus ?? ""),
              let identity = UUID(uuidString: response.sessionId) else { return }
        let scope = "\(client.serverURL.absoluteString)/\(client.profileId ?? "")/"
        pendingPracticeAdmissions = pendingPracticeAdmissions.filter { !$0.key.hasPrefix(scope) || $0.value != identity }
    }

    func refreshPractice(sessionId: String) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to resume practice.") }
        let response = try await client.fetchPractice(sessionId: sessionId)
        guard isCurrentLearningClient(client), practiceStart?.sessionId == sessionId else { return }
        practiceStart = response
        practiceResult = response.submissionResult
        clearSettledPracticeAdmission(response, client: client)
    }

    func practiceGenerationAction(sessionId: String, action: String, acknowledgeUnknownOutcome: Bool = false) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to manage practice.") }
        let response = try await client.practiceGenerationAction(sessionId: sessionId, action: action,
            acknowledgeUnknownOutcome: acknowledgeUnknownOutcome)
        guard isCurrentLearningClient(client), practiceStart?.sessionId == sessionId else { return }
        practiceStart = response
        clearSettledPracticeAdmission(response, client: client)
    }
}
