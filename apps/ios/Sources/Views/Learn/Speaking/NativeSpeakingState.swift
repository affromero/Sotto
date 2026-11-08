import SwiftUI

@MainActor
final class NativeSpeakingState: ObservableObject {
    @Published var recordingId: String?
    @Published var feedback: SottoSpeakingPollResponse?
    @Published var uploadUnknown = false
    @Published var recordingActive = false
    @Published var localAudioURL: URL?
    @Published var localBinding: SottoClassSpeakingBinding?
    var recordingOwner: SottoLearnerIdentity?
    @Published var uploadRejected = false

    func removeLocalRecording() throws {
        guard let url = localAudioURL else { return }
        try FileManager.default.removeItem(at: url)
        localAudioURL = nil
        if !uploadUnknown { localBinding = nil }
        uploadRejected = false
    }

    var canRecord: Bool {
        !recordingActive && !uploadUnknown && !uploadRejected && localAudioURL == nil && (recordingId == nil || feedback?.status == "SCORED" || feedback?.status == "FAILED" ||
            (feedback?.status == "UNRESOLVED" && feedback?.recoveryAcknowledged == true))
    }

    func receive(_ recording: SottoSpeakingRecording) {
        if uploadUnknown { return }
        if let recordingId, recordingId != recording.id && feedback?.status != "SCORED" && feedback?.status != "FAILED" { return }
        recordingId = recording.id
        uploadUnknown = false
        feedback = SottoSpeakingPollResponse(status: recording.status, transcript: recording.transcript,
            overallScore: recording.overallScore, rubricScores: recording.rubricScores,
            feedback: recording.feedback, phonemeScores: recording.phonemeScores,
            recoveryAcknowledged: recording.recoveryAcknowledged)
    }

    func acknowledgeRecovery(recordingId expected: String) {
        guard recordingId == expected, feedback?.status == "UNRESOLVED" else { return }
        feedback?.recoveryAcknowledged = true
    }
}
