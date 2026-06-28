import AVFoundation
import SwiftUI

struct ClassSpeakingPracticeView: View {
    let classId: String
    let prompts: [SottoSpeakingPrompt]
    let onSelectionHelp: (String, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Speaking", systemImage: "waveform")
                .font(.headline)
                .foregroundStyle(SottoTheme.ink)

            ForEach(prompts.sorted { ($0.order ?? 0) < ($1.order ?? 0) }) { prompt in
                ClassSpeakingPromptCard(
                    classId: classId,
                    prompt: prompt,
                    onSelectionHelp: onSelectionHelp
                )
            }
        }
        .padding(16)
        .background(SottoTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct ClassSpeakingPromptCard: View {
    @EnvironmentObject private var model: SottoAppModel

    let classId: String
    let prompt: SottoSpeakingPrompt
    let onSelectionHelp: (String, String) -> Void

    @State private var recorder: AVAudioRecorder?
    @State private var audioURL: URL?
    @State private var isRecording = false
    @State private var statusText: String?
    @State private var errorMessage: String?
    @State private var feedback: SottoSpeakingPollResponse?
    @State private var task: Task<Void, Never>?

    init(classId: String, prompt: SottoSpeakingPrompt, onSelectionHelp: @escaping (String, String) -> Void) {
        self.classId = classId
        self.prompt = prompt
        self.onSelectionHelp = onSelectionHelp
        if let recording = prompt.latestRecording {
            _feedback = State(
                initialValue: SottoSpeakingPollResponse(
                    status: recording.status,
                    transcript: recording.transcript,
                    overallScore: recording.overallScore,
                    rubricScores: recording.rubricScores,
                    feedback: recording.feedback,
                    phonemeScores: recording.phonemeScores
                )
            )
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    SpeakingPromptTextBlock(
                        label: "Say this",
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
                    if let ipa = prompt.ipa, !ipa.isEmpty {
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
                    Label(isRecording ? "Stop" : "Record", systemImage: isRecording ? "stop.fill" : "mic.fill")
                }
                .buttonStyle(SottoPrimaryButtonStyle())

                if let urlString = prompt.referenceTtsUrl, let url = URL(string: urlString) {
                    Link(destination: url) {
                        Label("Reference voice", systemImage: "speaker.wave.2")
                    }
                    .buttonStyle(SottoSecondaryButtonStyle())
                }
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
        .onDisappear {
            recorder?.stop()
            task?.cancel()
        }
    }

    private func startRecording() async {
        guard await requestMicrophoneAccess() else {
            errorMessage = "Microphone access is required to score pronunciation."
            return
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
            isRecording = true
            feedback = nil
            errorMessage = nil
            statusText = "Recording..."
        } catch {
            errorMessage = error.localizedDescription
            statusText = nil
        }
    }

    private func stopRecording() {
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let audioURL else { return }
        uploadAndPoll(audioURL)
    }

    private func uploadAndPoll(_ url: URL) {
        task?.cancel()
        task = Task { @MainActor in
            do {
                statusText = "Uploading voice sample..."
                errorMessage = nil
                let uploaded = try await model.uploadClassSpeakingRecording(
                    classId: classId,
                    promptId: prompt.id,
                    audioURL: url
                )

                statusText = "Scoring pronunciation..."
                let result = try await waitForFeedback(recordingId: uploaded.recordingId)
                feedback = result
                statusText = result.status == "SCORED" ? "Feedback ready." : result.status.capitalized
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
            let result = try await model.pollClassSpeakingRecording(
                classId: classId,
                promptId: prompt.id,
                recordingId: recordingId
            )
            if result.status != "PENDING" && result.status != "PROCESSING" {
                return result
            }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        throw SottoAPIError.message("Pronunciation scoring is still running. Come back in a moment.")
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
    let font: UIFont
    let color: Color
    let emphasized: Bool
    let onSelectionHelp: (String, String) -> Void

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
                onExamples: onSelectionHelp
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
                    ForEach(["accuracy", "fluency", "completeness"], id: \.self) { key in
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
