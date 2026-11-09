import AVFoundation
import SwiftUI

/// Where a speaking prompt is being recorded from. Class and exam speaking
/// share the upload-then-poll flow and differ only in the route.
enum SpeakingPromptSource: Equatable {
    case classSession(classId: String)
    case practice(sessionId: String)
    case exam(examId: String)

    var path: String {
        switch self {
        case let .classSession(id): "/api/v1/classes/\(id)"
        case let .practice(id): "/api/v1/practice/\(id)"
        case let .exam(id): "/api/v1/exams/\(id)"
        }
    }
}

struct ClassSpeakingPracticeView: View {
    @EnvironmentObject private var model: SottoAppModel
    let source: SpeakingPromptSource
    let prompts: [SottoSpeakingPrompt]
    let classBinding: SottoClassSpeakingBinding?
    let activityOwner: SottoLearnerIdentity?
    let onSelectionHelp: ((String, String) -> Void)?
    let prerequisite: SottoClassPrerequisiteResponse?
    let sectionId: String?

    init(
        source: SpeakingPromptSource,
        prompts: [SottoSpeakingPrompt],
        classBinding: SottoClassSpeakingBinding? = nil,
        activityOwner: SottoLearnerIdentity? = nil,
        prerequisite: SottoClassPrerequisiteResponse? = nil,
        sectionId: String? = nil,
        onSelectionHelp: ((String, String) -> Void)? = nil
    ) {
        self.source = source
        self.prompts = prompts
        self.classBinding = classBinding
        self.activityOwner = activityOwner
        self.prerequisite = prerequisite
        self.sectionId = sectionId
        self.onSelectionHelp = onSelectionHelp
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Speaking", systemImage: "waveform")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            Text("Read the phrase under Say this aloud. Tap Record, then Stop and send when you finish. Your recording is sent for pronunciation feedback. The meaning is a reading aid; you do not need to say it.")
                .font(.callout)
                .foregroundStyle(SottoTheme.muted)

            if let activityOwner, let client = model.makeClient(), SottoLearnerIdentity(client) == activityOwner {
              ForEach(prompts.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { prompt in
                if let prerequisite, let sectionId, let instruction = prerequisite.content?.directions.instruction(
                    sectionId: sectionId, taskId: prompt.id, kind: .speaking
                ) {
                    ClassPrerequisiteDirection(instruction: instruction, language: prerequisite.nativeLang)
                }
                ClassSpeakingPromptCard(
                    source: source,
                    prompt: prompt,
                    classBinding: classBinding,
                    saved: model.speakingState(source: source, promptId: prompt.id),
                    onSelectionHelp: onSelectionHelp
                )
              }
            } else {
                Text("Reopen the activity for the current learner before recording.")
                    .foregroundStyle(SottoTheme.muted)
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct ClassSpeakingPromptCard: View {
    @EnvironmentObject private var model: SottoAppModel

    let source: SpeakingPromptSource
    let prompt: SottoSpeakingPrompt
    let classBinding: SottoClassSpeakingBinding?
    let onSelectionHelp: ((String, String) -> Void)?

    @State private var recorder: AVAudioRecorder?
    @State private var audioURL: URL?
    @State private var isRecording = false
    @State private var statusText: String?
    @State private var errorMessage: String?
    @State private var confirmRecovery = false
    @State private var confirmDiscardRecording = false
    @State private var recoveryBusy = false
    @ObservedObject var saved: NativeSpeakingState
    private var feedback: SottoSpeakingPollResponse? {
        get { saved.feedback }
        nonmutating set { saved.feedback = newValue }
    }
    @State private var task: Task<Void, Never>?

    init(
        source: SpeakingPromptSource,
        prompt: SottoSpeakingPrompt,
        classBinding: SottoClassSpeakingBinding?,
        saved: NativeSpeakingState,
        onSelectionHelp: ((String, String) -> Void)?
    ) {
        self.source = source
        self.prompt = prompt
        self.classBinding = classBinding
        self.onSelectionHelp = onSelectionHelp
        self.saved = saved
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    SpeakingPromptTextBlock(
                        label: prompt.communicative ? "Your speaking task" : "Say this",
                        text: prompt.targetPhrase,
                        font: LearnerTextFonts.headline,
                        color: SottoTheme.ink,
                        emphasized: true,
                        onSelectionHelp: onSelectionHelp
                    )
                    SpeakingPromptTextBlock(
                        label: "Meaning / cue",
                        text: prompt.translation,
                        font: LearnerTextFonts.callout,
                        color: SottoTheme.muted,
                        emphasized: false,
                        onSelectionHelp: onSelectionHelp
                    )
                    if prompt.communicative {
                        Text("Respond in your own words in the language you are learning. Do not read the instruction aloud.")
                            .font(.caption).foregroundStyle(SottoTheme.muted)
                    }
                    if prompt.assessmentScope == "PRIVATE_SOURCE" {
                        Text("Private source feedback. This practice does not count toward level mastery.")
                            .font(.caption).foregroundStyle(SottoTheme.muted)
                    }
                    if !prompt.communicative, let ipa = prompt.ipa, !ipa.isEmpty {
                        Text(ipa)
                            .font(.caption.monospaced())
                            .foregroundStyle(SottoTheme.primary)
                    }
                }

                Spacer()

                if let score = feedback?.overallScore {
                    Text(percent(score))
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(SottoTheme.primary)
                }
            }

            HStack(spacing: 10) {
                Button {
                    if isRecording {
                        stopRecording()
                    } else {
                        Task { await startRecording() }
                    }
                } label: {
                    Label(isRecording ? "Stop and send" : "Record", systemImage: isRecording ? "stop.fill" : "mic.fill")
                }
                .buttonStyle(SottoPrimaryButtonStyle())
                .disabled(!isRecording && !saved.canRecord)

                if !prompt.communicative, let reference = prompt.referenceTtsUrl {
                    LearnerAudioPlayer(reference: reference)
                }
            }

            if saved.recordingId != nil && !saved.canRecord || saved.uploadUnknown {
                Button("Check saved recording") {
                    task?.cancel()
                    task = Task {
                        if saved.uploadUnknown {
                            do {
                                guard let owner = saved.recordingOwner else { throw CancellationError() }
                                if let recording = try await model.latestSpeakingRecording(source: source, promptId: prompt.id, expectedClassBinding: saved.localBinding, expectedLearner: owner) {
                                    saved.receive(recording)
                                }
                                if saved.uploadUnknown { errorMessage = "The upload outcome is still unknown and cannot be confirmed automatically. Keep your recording before leaving." }
                            } catch { errorMessage = error.localizedDescription }
                        }
                        if let id = saved.recordingId { await resumeFeedback(recordingId: id) }
                    }
                }.buttonStyle(SottoSecondaryButtonStyle())
            }

            if case .classSession = source, saved.feedback?.status == "UNRESOLVED", !saved.canRecord {
                Button("Review another attempt") { confirmRecovery = true }
                    .buttonStyle(SottoSecondaryButtonStyle())
                    .disabled(recoveryBusy)
            }

            if let statusText {
                Text(statusText)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.muted)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(Color.red.opacity(0.82))
            }

            if !saved.recordingActive, let localAudioURL = saved.localAudioURL {
                ShareLink("Save recording", item: localAudioURL).buttonStyle(SottoSecondaryButtonStyle())
                Button("Remove local recording", role: .destructive) { confirmDiscardRecording = true }
                    .buttonStyle(SottoSecondaryButtonStyle())
            }

            if let feedback {
                SpeakingFeedbackBlock(feedback: feedback)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SottoTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(SottoTheme.line)
        )
        .task(id: "\(prompt.latestRecording?.id ?? "")/\(prompt.latestRecording?.status ?? "")") {
            guard (try? recordingClient()) != nil else { return }
            if let recording = prompt.latestRecording {
                if !saved.uploadUnknown { saved.receive(recording) }
            }
            if let id = saved.recordingId, !saved.canRecord { await resumeFeedback(recordingId: id) }
        }
        .onDisappear {
            recorder?.stop()
            task?.cancel()
            saved.recordingActive = false
        }
        .confirmationDialog("Start another attempt?", isPresented: $confirmRecovery, titleVisibility: .visible) {
            Button("I understand, continue") {
                guard case let .classSession(classId) = source, let recordingId = saved.recordingId else { return }
                recoveryBusy = true
                Task {
                    defer { recoveryBusy = false }
                    do {
                        let client = try recordingClient()
                        try await model.acknowledgeClassSpeakingRecovery(classId: classId, promptId: prompt.id, recordingId: recordingId)
                        guard model.isCurrentLearningClient(client) else { throw CancellationError() }
                        saved.acknowledgeRecovery(recordingId: recordingId)
                        errorMessage = nil
                    } catch is CancellationError {
                        errorMessage = "The acknowledgment could not be confirmed. Check saved recording."
                    } catch {
                        errorMessage = "Recovery is not ready. Review the teaching and ask your server administrator to confirm cleanup."
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The earlier provider request may still complete or incur a charge. A new attempt may incur another charge.")
        }
        .confirmationDialog("Remove local recording?", isPresented: $confirmDiscardRecording, titleVisibility: .visible) {
            Button("Remove recording", role: .destructive) {
                do {
                    try saved.removeLocalRecording()
                } catch { errorMessage = "The local recording could not be removed." }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Save the recording first if you want to keep it.") }
    }

    private func startRecording() async {
        guard let client = try? recordingClient() else {
            errorMessage = "Reopen the activity for the current learner before recording."
            return
        }
        if case .classSession = source, classBinding == nil {
            errorMessage = "Reopen the class before recording."
            return
        }
        saved.localBinding = classBinding
        saved.recordingOwner = SottoLearnerIdentity(client)
        saved.recordingActive = true
        guard await requestMicrophoneAccess() else {
            saved.recordingActive = false
            errorMessage = "Microphone access is required to score pronunciation."
            return
        }
        guard saved.recordingActive else { return }
        guard model.isCurrentLearningClient(client) else {
            saved.recordingActive = false
            errorMessage = "The learner changed. Reopen the activity before recording."
            return
        }
        if case let .classSession(classId) = source {
            guard let binding = classBinding, model.selectedClass?.id == classId,
                  model.selectedClass?.attempt == binding.attempt,
                  model.selectedClass?.taskMaterialRevision == binding.materialRevision else {
                saved.recordingActive = false
                errorMessage = "The class changed. Reopen it before recording."
                return
            }
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("sotto-\(prompt.id)-\(UUID().uuidString).wav")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ]
            let nextRecorder = try AVAudioRecorder(url: url, settings: settings)
            nextRecorder.prepareToRecord()
            nextRecorder.record()

            recorder = nextRecorder
            audioURL = url
            saved.localAudioURL = url
            saved.uploadRejected = false
            isRecording = true
            saved.recordingId = nil
            feedback = nil
            errorMessage = nil
            statusText = "Recording..."
        } catch {
            saved.recordingActive = false
            errorMessage = error.localizedDescription
            statusText = nil
        }
    }

    private func stopRecording() {
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let audioURL else { saved.recordingActive = false; return }
        uploadAndPoll(audioURL)
        saved.recordingActive = false
    }

    private func resumeFeedback(recordingId: String) async {
        do {
            statusText = "Checking saved recording..."
            feedback = try await waitForFeedback(recordingId: recordingId)
            statusText = feedback?.status == "SCORED" ? "Feedback ready." : feedback?.status.capitalized
        } catch {
            if !Task.isCancelled { errorMessage = "Your recording is saved. \(error.localizedDescription)" }
        }
    }

    private func uploadAndPoll(_ url: URL) {
        saved.uploadUnknown = true
        task?.cancel()
        task = Task { @MainActor in
            do {
                statusText = "Uploading voice sample..."
                errorMessage = nil
                let uploaded = try await upload(url)
                try Task.checkCancellation()
                _ = try recordingClient()
                saved.recordingId = uploaded.recordingId
                saved.uploadUnknown = false
                do {
                    try saved.removeLocalRecording()
                } catch {
                    errorMessage = "Your recording was uploaded, but its local copy could not be removed. You can save or remove it below."
                }

                statusText = "Scoring pronunciation..."
                let result = try await waitForFeedback(recordingId: uploaded.recordingId)
                feedback = result
                statusText = result.status == "SCORED" ? "Feedback ready." : result.status.capitalized
            } catch let SottoAPIError.classRecordingRejected(message) {
                saved.uploadUnknown = false
                saved.uploadRejected = true
                errorMessage = "\(message) Save your recording before reopening the class."
                statusText = nil
            } catch is CancellationError {
                statusText = nil
            } catch {
                errorMessage = error.localizedDescription
                statusText = nil
            }
        }
    }

    private func waitForFeedback(recordingId: String) async throws -> SottoSpeakingPollResponse {
        for _ in 0..<50 {
            try Task.checkCancellation()
            let result = try await poll(recordingId: recordingId)
            if result.status == "SCORED" || result.status == "FAILED" || result.status == "UNRESOLVED" {
                return result
            }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        throw SottoAPIError.message("Pronunciation scoring is still running. Come back in a moment.")
    }

    private func upload(_ url: URL) async throws -> SottoSpeakingUploadResponse {
        guard let owner = saved.recordingOwner, let client = model.makeClient(),
              SottoLearnerIdentity(client) == owner else {
            throw SottoAPIError.classRecordingRejected("The learner changed. Your recording remains on this device.")
        }
        switch source {
        case let .classSession(classId):
            guard let recordedBinding = saved.localBinding else { throw SottoAPIError.message("Reopen the class before recording.") }
            return try await model.uploadClassSpeakingRecording(
                classId: classId,
                promptId: prompt.id,
                audioURL: url,
                binding: recordedBinding,
                expectedLearner: owner
            )
        case let .practice(sessionId):
            return try await model.uploadPracticeSpeakingRecording(
                sessionId: sessionId,
                promptId: prompt.id,
                audioURL: url
            )
        case let .exam(examId):
            return try await model.uploadExamSpeakingRecording(
                examId: examId,
                promptId: prompt.id,
                audioURL: url
            )
        }
    }

    private func poll(recordingId: String) async throws -> SottoSpeakingPollResponse {
        let client = try recordingClient()
        let result: SottoSpeakingPollResponse
        switch source {
        case let .classSession(classId):
            result = try await model.pollClassSpeakingRecording(
                classId: classId,
                promptId: prompt.id,
                recordingId: recordingId
            )
        case let .practice(sessionId):
            result = try await model.pollPracticeSpeakingRecording(
                sessionId: sessionId,
                promptId: prompt.id,
                recordingId: recordingId
            )
        case let .exam(examId):
            result = try await model.pollExamSpeakingRecording(
                examId: examId,
                promptId: prompt.id,
                recordingId: recordingId
            )
        }
        guard model.isCurrentLearningClient(client) else { throw CancellationError() }
        return result
    }

    private func recordingClient() throws -> SottoAPIClient {
        guard let client = model.makeClient(), let owner = saved.recordingOwner,
              owner == SottoLearnerIdentity(client) else {
            throw CancellationError()
        }
        return client
    }

    private func requestMicrophoneAccess() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

private struct SpeakingPromptTextBlock: View {
    let label: String
    let text: String
    let font: LearnerTextFont
    let color: Color
    let emphasized: Bool
    let onSelectionHelp: ((String, String) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(SottoTheme.primary)
                .textCase(.uppercase)
                .tracking(0.8)
            SelectableLearnerText(
                text,
                font: font,
                color: UIColor(color),
                onExamples: onSelectionHelp ?? { _, _ in }
            )
        }
        .padding(emphasized ? 12 : 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(emphasized ? SottoTheme.paper : SottoTheme.paper.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(emphasized ? SottoTheme.primary.opacity(0.25) : SottoTheme.line)
        )
    }
}

private struct SpeakingFeedbackBlock: View {
    let feedback: SottoSpeakingPollResponse

    private var focusTokens: [SottoSpeakingAlignmentToken] {
        (feedback.phonemeScores ?? [])
            .filter { $0.op != "match" }
            .prefix(4)
            .map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let transcript = feedback.transcript, !transcript.isEmpty {
                Text("\"\(transcript)\"")
                    .font(.callout.italic())
                    .foregroundStyle(SottoTheme.muted)
            }

            if let rubric = feedback.rubricScores {
                HStack(spacing: 6) {
                    ForEach(["communicative", "accuracy", "fluency", "completeness"], id: \.self) { key in
                        if let value = rubric[key] {
                            Text("\(key) \(percent(value))")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(SottoTheme.muted)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(SottoTheme.paper)
                                .clipShape(Capsule())
                        }
                    }
                }
            }

            if !focusTokens.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(focusTokens.enumerated()), id: \.offset) { _, token in
                        Text(focusText(token))
                            .font(.caption.monospaced())
                            .foregroundStyle(Color.red.opacity(0.8))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.red.opacity(0.08))
                            .clipShape(Capsule())
                    }
                }
            }

            if let feedbackText = feedback.feedback, !feedbackText.isEmpty {
                Text(feedbackText)
                    .font(.callout)
                    .foregroundStyle(SottoTheme.ink)
            }
        }
        .padding(12)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
