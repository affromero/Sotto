import XCTest
@testable import Sotto

@MainActor
final class NativeSpeakingStateTests: XCTestCase {
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

    func testUncertainUploadCannotBorrowAnOlderCompletedRecording() {
        let saved = NativeSpeakingState()
        saved.previousRecordingId = "earlier"
        saved.uploadUnknown = true
        saved.receive(recording(id: "earlier", status: "SCORED", score: 0.9))
        XCTAssertTrue(saved.uploadUnknown)
        XCTAssertFalse(saved.canRecord)
        XCTAssertNil(saved.recordingId)
        saved.receive(recording(id: "current", status: "GRADING"))
        XCTAssertFalse(saved.uploadUnknown)
        XCTAssertEqual(saved.recordingId, "current")
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
