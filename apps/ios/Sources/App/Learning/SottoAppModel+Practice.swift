import Foundation

@MainActor
final class NativeLearningSessionState {
    private(set) var owner: SottoLearnerIdentity?
    let progress = LearningProgressStore()
    let drafts = WritingDraftStore()
    var speaking: [String: NativeSpeakingState] = [:]

    init(owner: SottoLearnerIdentity? = nil) { self.owner = owner }

    func bindOwner(_ next: SottoLearnerIdentity?) {
        guard let next, next != owner else { return }
        owner = next
        for saved in speaking.values where saved.canRecord {
            saved.recordingOwner = next
        }
    }
}

extension SottoAppModel {
    func startVocabularyStudy(courseId: String, mode: SottoVocabularyMode, requestId: UUID, wordIds: [String] = []) async throws -> SottoPracticeStart {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to study vocabulary.") }
        let response = try await client.startVocabularyStudy(courseId: courseId, requestId: requestId, mode: mode, wordIds: wordIds)
        guard isCurrentLearningClient(client), courses.contains(where: { $0.id == courseId }) else { throw CancellationError() }
        guard response.isVocabularyStudy, response.courseId == courseId,
              response.sessionId.lowercased() == requestId.uuidString.lowercased(), response.mode == mode.rawValue,
              response.cards?.isEmpty == false, response.progressRevision != nil else {
            throw SottoAPIError.message("The saved vocabulary session could not be verified. Retry the same request.")
        }
        return response
    }

    func presentVocabularyStudy(_ response: SottoPracticeStart, courseId: String) {
        practiceCourses[response.sessionId] = courseId
        practiceResult = nil
        practiceStart = response
    }

    func acknowledgeClassSpeakingRecovery(classId: String, promptId: String, recordingId: String) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to recover speaking work.") }
        try await client.acknowledgeClassSpeakingRecovery(classId: classId, promptId: promptId, recordingId: recordingId)
        guard isCurrentLearningClient(client), selectedClass?.id == classId else { throw CancellationError() }
    }
    func speakingState(source: SpeakingPromptSource, promptId: String) -> NativeSpeakingState {
        let attempt: Int
        if case let .classSession(id) = source, selectedClass?.id == id { attempt = selectedClass?.attempt ?? 1 }
        else { attempt = 1 }
        let state = learningSessionState(path: source.path, attempt: attempt, revision: 0)
        if let saved = state.speaking[promptId] { return saved }
        let saved = NativeSpeakingState()
        if let client = makeClient() { saved.recordingOwner = SottoLearnerIdentity(client) }
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

    func latestSpeakingRecording(source: SpeakingPromptSource, promptId: String,
        expectedClassBinding: SottoClassSpeakingBinding? = nil,
        expectedLearner: SottoLearnerIdentity) async throws -> SottoSpeakingRecording? {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to check your recording.") }
        guard SottoLearnerIdentity(client) == expectedLearner else { throw CancellationError() }
        let recording: SottoSpeakingRecording?
        switch source {
        case let .classSession(id):
            guard let expectedClassBinding else { throw SottoAPIError.message("The original class identity is unavailable.") }
            let detail = try await client.fetchClass(classId: id)
            guard detail.id == id, detail.attempt == expectedClassBinding.attempt,
                  detail.taskMaterialRevision == expectedClassBinding.materialRevision,
                  selectedClass?.id == id, selectedClass?.attempt == expectedClassBinding.attempt,
                  selectedClass?.taskMaterialRevision == expectedClassBinding.materialRevision else {
                throw SottoAPIError.message("The class changed. Your recording remains on this device.")
            }
            recording = detail.sections.flatMap(\.prompts).first { $0.id == promptId }?.latestRecording
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
        return SottoLearnerIdentity(current) == SottoLearnerIdentity(client)
    }

    func learningSessionState(path: String, attempt: Int, revision: Int) -> NativeLearningSessionState {
        let client = makeClient()
        let key = "\(client?.serverURL.absoluteString ?? "")/\(client?.profileId ?? "")/\(path)/\(attempt)"
        let state = learningSessions[key] ?? NativeLearningSessionState(owner: client.map(SottoLearnerIdentity.init))
        state.bindOwner(client.map(SottoLearnerIdentity.init))
        let detail = selectedClass.flatMap { path == "/api/v1/classes/\($0.id)" ? $0 : nil }
        state.progress.configure(client: client, path: path, revision: revision,
            attempt: detail?.attempt ?? (detail == nil ? nil : attempt), materialRevision: detail?.taskMaterialRevision,
            isCurrent: { [weak self] in
                guard let self, let client else { return false }
                return self.isCurrentLearningClient(client)
            })
        learningSessions[key] = state
        return state
    }

    func startPractice(courseId: String, kind: String, learningSelection: SottoLearningSelection? = nil) async {
        guard let client = makeClient() else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let selectionKey: String
        do { selectionKey = try learningSelection.map { String(decoding: try encoder.encode($0), as: UTF8.self) } ?? "" }
        catch { report(error); return }
        let key = "\(client.serverURL.absoluteString)/\(client.profileId ?? "")/\(courseId)/\(kind)/\(selectionKey)"
        let requestId = pendingPracticeAdmissions[key] ?? UUID()
        pendingPracticeAdmissions[key] = requestId
        isLoading = true
        loadingOperation = SottoLoadingOperation(title: "Starting \(kind.lowercased() == "vocab" ? "vocabulary" : kind.lowercased()) practice",
            detail: "Saving your request. Generation continues on the server.", progress: nil,
            currentStep: nil, totalSteps: nil, elapsedSeconds: nil, remainingSeconds: nil)
        errorMessage = nil
        defer { isLoading = false; loadingOperation = nil }
        do {
            let response = try await client.startPractice(courseId: courseId, kind: kind, requestId: requestId, learningSelection: learningSelection)
            guard isCurrentLearningClient(client), courses.contains(where: { $0.id == courseId }) else { return }
            let admitted = response.preservingContext(kind: kind, sessionId: requestId.uuidString)
            practiceStart = admitted
            practiceCourses[admitted.sessionId] = courseId
            practiceResult = admitted.submissionResult
            clearSettledPracticeAdmission(admitted, client: client)
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
        let admitted = response.preservingContext(kind: practiceStart?.kind, sessionId: sessionId)
        practiceStart = admitted
        practiceResult = response.submissionResult
        clearSettledPracticeAdmission(admitted, client: client)
    }

    func reloadPracticeDiscardingLocalEdits(sessionId: String, progress: LearningProgressStore) async throws {
        guard practiceRecoveryId == nil, let client = makeClient(),
              let original = practiceStart, original.sessionId == sessionId else {
            throw SottoAPIError.message("The practice session changed. Your edits are still kept here.")
        }
        let key = "\(client.serverURL.absoluteString)/\(client.profileId ?? "")//api/v1/practice/\(sessionId)/1"
        guard let state = learningSessions[key], state.progress === progress else {
            throw SottoAPIError.message("The practice session changed. Your edits are still kept here.")
        }
        guard !state.drafts.isSubmitting, !state.drafts.drafts.values.contains(where: { $0.unknownText != nil }) else {
            throw SottoAPIError.message("Resolve the writing submission before reloading this practice.")
        }
        guard !state.speaking.values.contains(where: { $0.recordingActive || $0.uploadUnknown }) else {
            throw SottoAPIError.message("Finish your speaking work before reloading this practice. Your edits are still kept here.")
        }
        let operation = UUID()
        practiceRecoveryId = operation
        defer { if practiceRecoveryId == operation { practiceRecoveryId = nil } }
        let previousGeneration = progress.recoveryGeneration
        let draftTexts = state.drafts.texts
        let writingGeneration = state.drafts.operationGeneration
        await progress.suspend()
        let generation = progress.recoveryGeneration
        do {
            try Task.checkCancellation()
            guard isCurrentLearningClient(client), generation == previousGeneration + 1, state.drafts.texts == draftTexts,
                  state.drafts.operationGeneration == writingGeneration else {
                throw SottoAPIError.message("Your edits changed. Review them before reloading.")
            }
            let latest = try await client.fetchPractice(sessionId: sessionId)
            try Task.checkCancellation()
            guard isCurrentLearningClient(client), practiceRecoveryId == operation,
                  practiceStart == original, learningSessions[key] === state,
                  latest.sessionId == sessionId, latest.progressRevision.map({ $0 >= 0 }) == true,
                  original.courseId == nil || latest.courseId == original.courseId,
                  latest.status == original.status, latest.submissionResult == nil,
                  ((latest.status == "ready" && latest.items?.isEmpty == false) ||
                   (latest.status == "ready_writing" && latest.writingPrompts?.isEmpty == false) ||
                   (latest.status == "ready_speaking" && latest.speakingPrompts?.isEmpty == false) ||
                   (latest.status == "ready_full" && latest.items?.isEmpty == false &&
                    (latest.writingPrompts?.count ?? 0) >= (original.writingPrompts?.count ?? 0) &&
                    (latest.speakingPrompts?.count ?? 0) >= (original.speakingPrompts?.count ?? 0))),
                  !state.speaking.values.contains(where: { $0.recordingActive || $0.uploadUnknown }), !state.drafts.isSubmitting,
                  !state.drafts.drafts.values.contains(where: { $0.unknownText != nil }),
                  state.drafts.texts == draftTexts, state.drafts.operationGeneration == writingGeneration,
                  progress.recoveryGeneration == generation else {
                throw SottoAPIError.message("The practice session changed. Your edits are still kept here.")
            }
            let replacement = NativeLearningSessionState(owner: state.owner)
            replacement.speaking = state.speaking
            progress.discard()
            learningSessions[key] = replacement
            practiceStart = latest.preservingContext(kind: original.kind, sessionId: sessionId)
            practiceResult = latest.submissionResult
        } catch {
            progress.resumeWithoutSaving()
            throw error
        }
    }

    func practiceGenerationAction(sessionId: String, action: String, acknowledgeUnknownOutcome: Bool = false) async throws {
        guard let client = makeClient() else { throw SottoAPIError.message("Pair this device to manage practice.") }
        let response = try await client.practiceGenerationAction(sessionId: sessionId, action: action,
            acknowledgeUnknownOutcome: acknowledgeUnknownOutcome)
        guard isCurrentLearningClient(client), practiceStart?.sessionId == sessionId else { return }
        let admitted = response.preservingContext(kind: practiceStart?.kind, sessionId: sessionId)
        practiceStart = admitted
        clearSettledPracticeAdmission(admitted, client: client)
    }

    func refreshPreparingPracticeOverview() async {
        guard let courseId = practiceOverviewCourseId, practiceOverview?.preparing.isEmpty == false else { return }
        await loadPracticeOverview(courseId: courseId)
    }

    func closePractice() {
        let courseId = practiceStart.flatMap { practiceCourses[$0.sessionId] }
        practiceStart = nil
        practiceResult = nil
        guard let courseId, let client = makeClient() else { return }
        Task {
            guard isCurrentLearningClient(client) else { return }
            await loadPracticeOverview(courseId: courseId)
        }
    }
}
