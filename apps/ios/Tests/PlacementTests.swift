import XCTest

@testable import Sotto

final class PlacementTests: XCTestCase {
    func testPlacementBatchDecodes() throws {
        let batch = try JSONDecoder().decode(
            SottoPlacementBatch.self,
            from: Data(
                """
                {
                  "native": "en",
                  "target": "de",
                  "placementSessionId": "d1438bc6-a9a6-4c4a-bf12-e7b11c79110a",
                  "status": "READY",
                  "questionsDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                  "expiresAt": "2099-01-01T00:00:00.000Z",
                  "questions": [
                    {
                      "id": "pq_0",
                      "cefr": "A2",
                      "skill": "grammar",
                      "prompt": "Ich ___ nach Hause.",
                      "options": ["gehe", "gehst", "geht", "gehen", "I do not know"]
                    }
                  ]
                }
                """.utf8
            )
        )

        XCTAssertEqual(batch.target, "de")
        XCTAssertEqual(batch.questions.first?.options.count, 5)
        XCTAssertEqual(batch.status, "READY")
    }

    /// The scorer treats index 4 as "I don't know", which is distinct from a
    /// wrong guess. Encoding it as anything else would misplace the learner.
    func testDontKnowAnswerEncodesAsIndexFour() throws {
        XCTAssertEqual(SottoPlacementAnswer.dontKnowIndex, 4)

        let encoded = try JSONEncoder().encode(
            SottoPlacementAnswer(id: "pq_0", selectedIndex: SottoPlacementAnswer.dontKnowIndex)
        )
        let decoded = try JSONSerialization.jsonObject(with: encoded) as? [String: Any]

        XCTAssertEqual(decoded?["selectedIndex"] as? Int, 4)
    }

    func testPlacementResultDecodes() throws {
        let result = try JSONDecoder().decode(
            SottoPlacementResult.self,
            from: Data(
                """
                { "courseId": "c1", "level": "A2", "assessedLevel": "B1", "confirmationReceiptId": "d1438bc6-a9a6-4c4a-bf12-e7b11c79110a", "scoreBySkill": { "grammar": 0.7 } }
                """.utf8
            )
        )

        XCTAssertEqual(result.level, "A2")
        XCTAssertEqual(result.assessedLevel, "B1")
        XCTAssertEqual(result.scoreBySkill?["grammar"], 0.7)
    }

    /// Manual placement answers a missing model key with a bare
    /// "Manual placement failed", which tells the learner nothing.
    func testBareManualFailureIsRewritten() {
        let shown = SottoPlacementFailure.message(
            for: SottoAPIError.message("Manual placement failed")
        )

        XCTAssertTrue(shown.contains("web app"))
    }

    func testResolverMessageMentioningKeysIsRewritten() {
        let shown = SottoPlacementFailure.message(
            for: SottoAPIError.message("No API key configured for provider openai")
        )

        XCTAssertFalse(shown.lowercased().contains("api key"))
    }

    func testRateLimitMessagePassesThrough() {
        let shown = SottoPlacementFailure.message(
            for: SottoAPIError.message("Rate limit exceeded. Try again later.")
        )

        XCTAssertEqual(shown, "Rate limit exceeded. Try again later.")
    }
}
