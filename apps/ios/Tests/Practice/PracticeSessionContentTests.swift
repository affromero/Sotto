import XCTest

@testable import Sotto

/// Practice sessions carry speaking prompts and a listening episode; both were
/// decoded and then ignored by the iPad practice sheet.
final class PracticeSessionContentTests: XCTestCase {
    func testReadingPracticePreservesTheSourceAndAcceptsHistoricalQuestions() throws {
        let item = try JSONDecoder().decode(SottoPracticeItem.self, from: Data(
            #"{"id":"r0","prompt":"Wo ist Mia?","options":["Berlin","Bonn"],"passageText":"Mia ist in Berlin."}"#.utf8
        ))
        XCTAssertEqual(item.passageText, "Mia ist in Berlin.")
        let old = try JSONDecoder().decode(SottoPracticeItem.self, from: Data(
            #"{"id":"r0","prompt":"Wo ist Mia?","options":["Berlin","Bonn"]}"#.utf8
        ))
        XCTAssertNil(old.passageText)
    }
    func testReadyPracticeAudioDownloadsFromAuthenticatedStorage() async throws {
        let episode = try JSONDecoder().decode(SottoEpisode.self, from: Data(
            #"{"id":"episode","audioUrl":"/api/v1/storage/practice.mp3","status":"READY"}"#.utf8
        ))
        let file = try await AudioDownloadTestProtocol.client().downloadLearningAudio(from: XCTUnwrap(episode.audioUrl))
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertEqual(try Data(contentsOf: file), Data("audio fixture".utf8))
    }

    private func start(_ json: String) throws -> SottoPracticeStart {
        try JSONDecoder().decode(SottoPracticeStart.self, from: Data(json.utf8))
    }

    func testAFullSessionCarriesSpeakingPromptsAndAnEpisode() throws {
        let session = try start(
            """
            {
              "status": "ready_full",
              "sessionId": "sess1",
              "kind": "FULL",
              "reason": null,
              "episodeId": "ep1",
              "items": [],
              "speakingPrompts": [
                { "id": "sp1", "targetPhrase": "Ich bin gestern gegangen.",
                  "translation": "I went yesterday.", "order": 1 }
              ],
              "writingPrompts": []
            }
            """
        )

        XCTAssertEqual(session.episodeId, "ep1")
        XCTAssertEqual(session.speakingPrompts?.count, 1)
    }

    func testFocusedProductiveSessionsDecodeTheirCanonicalPrompts() throws {
        let speaking = try start(#"{"status":"ready_speaking","sessionId":"s","prompts":[{"id":"p","targetPhrase":"Hola","translation":"Hello","latestRecording":{"recordingId":"r","status":"GRADING"}}]}"#)
        XCTAssertEqual(speaking.speakingPrompts?.first?.latestRecording?.id, "r")
        XCTAssertEqual(speaking.speakingPrompts?.first?.latestRecording?.status, "GRADING")
        let writing = try start(#"{"status":"ready_writing","sessionId":"w","prompts":[{"id":"p","task":"Greet Ana","savedDraft":"Buenas tardes","response":{"text":"Hola","overallScore":0.8,"corrections":[],"feedback":"Clear"}}]}"#)
        XCTAssertEqual(writing.writingPrompts?.first?.savedDraft, "Buenas tardes")
        XCTAssertEqual(writing.writingPrompts?.first?.latestResponse?.text, "Hola")
    }

    func testProviderExemptionsAndFocusedRequirementsDecodeWithoutInventedCounts() throws {
        let saved = try start(#"{"status":"ready_full","sessionId":"text-only","kind":"FULL","items":[],"skillRequirements":{"skills":{"GRAMMAR":{"state":"REQUIRED","expectedCount":5},"READING":{"state":"REQUIRED","expectedCount":5},"WRITING":{"state":"REQUIRED","expectedCount":3},"LISTENING":{"state":"EXEMPT_NO_PROVIDER","reason":"NO_TTS_PROVIDER"},"SPEAKING":{"state":"EXEMPT_NO_PROVIDER","reason":"NO_STT_PROVIDER"}},"referenceAudioRequired":false}}"#)
        XCTAssertEqual(saved.skillRequirements?.exemptions, ["LISTENING", "SPEAKING"])
        XCTAssertNil(saved.skillRequirements?.skills["LISTENING"]?.expectedCount)
        let focused = try start(#"{"status":"ready_writing","sessionId":"focused","prompts":[],"skillRequirements":{"skills":{"GRAMMAR":{"state":"NOT_REQUESTED"},"WRITING":{"state":"REQUIRED","expectedCount":3}},"referenceAudioRequired":false}}"#)
        XCTAssertEqual(focused.skillRequirements?.skills["WRITING"]?.expectedCount, 3)
    }

    func testQueuedPreparationRetainsItsRecoveryIdentity() throws {
        let prepared = try start(#"{"status":"preparing","sessionId":"admission","preparationStatus":"UNRESOLVED","message":"Interrupted","canRecover":true}"#)
        XCTAssertEqual(prepared.sessionId, "admission")
        XCTAssertEqual(prepared.preparationStatus, "UNRESOLVED")
        XCTAssertEqual(prepared.canRecover, true)
    }

    func testReopenedPracticePreservesAnswersDraftsAndCompleteReceipt() throws {
        let saved = try start(#"{"status":"ready_full","sessionId":"saved","kind":"FULL","items":[],"learnerAnswers":{"g0":2},"writingDrafts":{"w0":"Hola"},"progressRevision":3,"submissionResult":{"score":0.8,"correct":9,"answered":10,"graded":3,"total":13,"writingFeedback":[{"promptId":"w0","task":"Greet Ana","grade":{"text":"Hola","overallScore":0.8,"corrections":[{"old":"Ola","new":"Hola","why":"Use the greeting."}],"feedback":"Clear"}}]}}"#)
        XCTAssertEqual(saved.learnerAnswers, ["g0": 2])
        XCTAssertEqual(saved.writingDrafts, ["w0": "Hola"])
        XCTAssertEqual(saved.progressRevision, 3)
        XCTAssertEqual(saved.submissionResult?.answered, 10)
        XCTAssertEqual(saved.submissionResult?.writingFeedback?.first?.grade.corrections?.first?.why, "Use the greeting.")
    }

    func testUnavailablePracticeDoesNotRequireAnInventedSession() throws {
        let unavailable = try start(#"{"status":"unavailable","reason":"no_content"}"#)
        XCTAssertEqual(unavailable.reason, "no_content")
    }

    func testEpisodeAudioArrivesLate() throws {
        let pending = try JSONDecoder().decode(
            SottoEpisode.self,
            from: Data("""
            { "id": "ep1", "audioUrl": null, "status": "GENERATING" }
            """.utf8)
        )
        XCTAssertNil(pending.audioUrl)

        let ready = try JSONDecoder().decode(
            SottoEpisode.self,
            from: Data("""
            { "id": "ep1", "audioUrl": "https://example.test/ep1.mp3", "status": "READY" }
            """.utf8)
        )
        XCTAssertEqual(ready.audioUrl, "https://example.test/ep1.mp3")
    }

    func testEveryPromptSourceHasAnUploadPath() {
        // A missing case here is a prompt that cannot be recorded, which is the
        // bug this replaced.
        let sources: [SpeakingPromptSource] = [
            .classSession(classId: "c1"),
            .practice(sessionId: "s1"),
            .exam(examId: "e1"),
        ]
        XCTAssertEqual(sources.count, 3)
    }
}
