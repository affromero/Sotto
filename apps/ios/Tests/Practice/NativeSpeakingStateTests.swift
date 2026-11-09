import XCTest
@testable import Sotto

@MainActor
final class NativeSpeakingStateTests: XCTestCase {
    @MainActor
    func testActiveRecordingPreventsAnotherRecording() {
        let state = NativeSpeakingState()
        state.recordingActive = true
        XCTAssertFalse(state.canRecord)
        state.recordingActive = false
        XCTAssertTrue(state.canRecord)
    }

    func testRejectedRecordingRemainsAvailableAcrossViewRecreation() {
        let state = NativeSpeakingState()
        let recording = URL(fileURLWithPath: "/tmp/sotto-retained.wav")
        state.localAudioURL = recording
        state.uploadRejected = true
        XCTAssertFalse(state.canRecord)
        let reopened = state
        XCTAssertEqual(reopened.localAudioURL, recording)
        XCTAssertTrue(reopened.uploadRejected)
        reopened.localAudioURL = nil
        reopened.uploadRejected = false
        XCTAssertTrue(reopened.canRecord)
    }
    func testCommunicativeSourceTaskRetainsItsPrivateFeedbackScope() throws {
        let prompt = try JSONDecoder().decode(SottoSpeakingPrompt.self, from: Data(#"{"id":"speaking","targetPhrase":"Explain why the appointment changed.","translation":"Use your own explanation.","taskMode":"COMMUNICATIVE","assessmentScope":"PRIVATE_SOURCE"}"#.utf8))
        XCTAssertTrue(prompt.communicative)
        XCTAssertEqual(prompt.assessmentScope, "PRIVATE_SOURCE")
        XCTAssertNil(prompt.referenceTtsUrl)
        let legacy = try JSONDecoder().decode(SottoSpeakingPrompt.self, from: Data(#"{"id":"legacy","targetPhrase":"Guten Tag","translation":"Good day"}"#.utf8))
        XCTAssertFalse(legacy.communicative)
    }
    private func recording(id: String, status: String, score: Double? = nil) -> SottoSpeakingRecording {
        SottoSpeakingRecording(id: id, status: status, transcript: "Hola", overallScore: score,
            rubricScores: nil, phonemeScores: nil, feedback: "Both words are present.")
    }

    func testSavedPendingRecordingBlocksAnotherPaidUploadUntilFeedbackArrives() {
        let saved = NativeSpeakingState()
        saved.receive(recording(id: "current", status: "GRADING"))
        XCTAssertEqual(saved.recordingId, "current")
        XCTAssertFalse(saved.canRecord)
        saved.receive(recording(id: "current", status: "SCORED", score: 0.8))
        XCTAssertTrue(saved.canRecord)
        XCTAssertEqual(saved.feedback?.overallScore, 0.8)
    }

    func testUnresolvedGradingKeepsRecordingAndBlocksAnotherUpload() {
        let saved = NativeSpeakingState()
        saved.receive(recording(id: "current", status: "UNRESOLVED"))
        XCTAssertEqual(saved.recordingId, "current")
        XCTAssertEqual(saved.feedback?.status, "UNRESOLVED")
        XCTAssertFalse(saved.canRecord)
        saved.acknowledgeRecovery(recordingId: "other")
        XCTAssertFalse(saved.canRecord)
        saved.acknowledgeRecovery(recordingId: "current")
        XCTAssertTrue(saved.canRecord)
    }

    func testUncertainUploadCannotBorrowAnOlderCompletedRecording() {
        let saved = NativeSpeakingState()
        saved.uploadUnknown = true
        saved.receive(recording(id: "earlier", status: "SCORED", score: 0.9))
        XCTAssertTrue(saved.uploadUnknown)
        XCTAssertFalse(saved.canRecord)
        XCTAssertNil(saved.recordingId)
        saved.receive(recording(id: "current", status: "GRADING"))
        XCTAssertTrue(saved.uploadUnknown)
        XCTAssertNil(saved.recordingId)
        XCTAssertFalse(saved.canRecord)
    }

    func testDiscardingLocalAudioKeepsTheBindingForAnUncertainUpload() throws {
        let saved = NativeSpeakingState()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data("audio".utf8).write(to: url)
        let binding = SottoClassSpeakingBinding(attempt: 2, materialRevision: String(repeating: "a", count: 64))
        saved.localAudioURL = url
        saved.localBinding = binding
        saved.uploadUnknown = true
        try saved.removeLocalRecording()
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertEqual(saved.localBinding, binding)
        XCTAssertFalse(saved.canRecord)
        saved.receive(recording(id: "current", status: "SCORED"))
        XCTAssertTrue(saved.uploadUnknown)
        XCTAssertFalse(saved.canRecord)
    }

    func testFailedLocalCleanupKeepsRecordingDiscoverable() {
        let saved = NativeSpeakingState()
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        saved.localAudioURL = missing
        XCTAssertThrowsError(try saved.removeLocalRecording())
        XCTAssertEqual(saved.localAudioURL, missing)
        XCTAssertFalse(saved.canRecord)
    }

    func testOldServerProjectionDoesNotReplaceASavedPendingRecording() {
        let saved = NativeSpeakingState()
        saved.receive(recording(id: "current", status: "GRADING"))
        saved.receive(recording(id: "earlier", status: "SCORED", score: 0.9))
        XCTAssertEqual(saved.recordingId, "current")
        XCTAssertEqual(saved.feedback?.status, "GRADING")
        XCTAssertFalse(saved.canRecord)
    }
}
