import SwiftUI

@MainActor
final class NativeSpeakingState: ObservableObject {
    @Published var recordingId: String?
    @Published var feedback: SottoSpeakingPollResponse?
    @Published var uploadUnknown = false
    var previousRecordingId: String?

    var canRecord: Bool {
        !uploadUnknown && (recordingId == nil || feedback?.status == "SCORED" || feedback?.status == "FAILED")
    }

    func receive(_ recording: SottoSpeakingRecording) {
        if uploadUnknown && recording.id == previousRecordingId { return }
        if let recordingId, recordingId != recording.id && feedback?.status != "SCORED" && feedback?.status != "FAILED" { return }
        recordingId = recording.id
        uploadUnknown = false
        feedback = SottoSpeakingPollResponse(status: recording.status, transcript: recording.transcript,
            overallScore: recording.overallScore, rubricScores: recording.rubricScores,
            feedback: recording.feedback, phonemeScores: recording.phonemeScores)
    }
}
