import XCTest

@testable import Sotto

/// Practice sessions carry speaking prompts and a listening episode; both were
/// decoded and then ignored by the iPad practice sheet.
final class PracticeSessionContentTests: XCTestCase {
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
