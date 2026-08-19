import XCTest

@testable import SottoiPad

final class WritingSubmissionTests: XCTestCase {
    private func decode<T: Decodable>(_ json: String, as type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    func testGradeResponseDecodes() throws {
        let grade = try decode(
            """
            {
              "overallScore": 0.72,
              "corrections": [
                { "old": "je suis allé", "new": "je suis allée", "why": "Agreement with a feminine subject." }
              ],
              "feedback": "Clear structure. Watch past participle agreement."
            }
            """,
            as: SottoWritingGrade.self
        )

        XCTAssertEqual(grade.overallScore, 0.72, accuracy: 0.0001)
        XCTAssertEqual(grade.corrections.count, 1)
        XCTAssertEqual(grade.corrections.first?.new, "je suis allée")
        XCTAssertFalse(grade.feedback.isEmpty)
    }

    /// The class detail sends the learner's previous answer so the card opens
    /// with their text and score already in place.
    func testPromptCarriesPreviousResponse() throws {
        let prompt = try decode(
            """
            {
              "id": "wp_1",
              "order": 1,
              "task": "Describe your weekend in five sentences.",
              "guidance": null,
              "responses": [
                {
                  "text": "Ce week-end, je suis allée au marché.",
                  "overallScore": 0.8,
                  "corrections": [],
                  "feedback": "Nicely done."
                }
              ]
            }
            """,
            as: SottoWritingPrompt.self
        )

        XCTAssertEqual(prompt.latestResponse?.overallScore, 0.8)
        XCTAssertEqual(prompt.latestResponse?.text, "Ce week-end, je suis allée au marché.")
    }

    /// Older payloads and the practice start response omit `responses`.
    func testPromptWithoutResponsesDecodes() throws {
        let prompt = try decode(
            """
            { "id": "wp_2", "order": null, "task": "Write a short reply.", "guidance": "Two sentences." }
            """,
            as: SottoWritingPrompt.self
        )

        XCTAssertNil(prompt.latestResponse)
        XCTAssertEqual(prompt.guidance, "Two sentences.")
    }

    /// This device pairs with a server; it never configures one. A grader
    /// failure caused by server setup must not tell the learner to go edit
    /// settings they cannot reach from here.
    func testServerConfigurationFailureIsRewritten() {
        let raw = SottoAPIError.message("No Google API key configured for this provider")

        let shown = SottoWritingFailure.message(for: raw)

        XCTAssertFalse(shown.lowercased().contains("api key"))
        XCTAssertTrue(shown.contains("web app"))
    }

    func testOrdinaryFailurePassesThrough() {
        let raw = SottoAPIError.message("Prompt not found")

        XCTAssertEqual(SottoWritingFailure.message(for: raw), "Prompt not found")
    }
}
