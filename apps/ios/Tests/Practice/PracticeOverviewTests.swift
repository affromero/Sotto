import XCTest

@testable import Sotto

final class PracticeOverviewTests: XCTestCase {
    func testCanonicalOnlyReviewAppearsOverallAndInItsQualifiedSkills() throws {
        let result = try overview("""
        {"due":{"vocab":0,"grammar":0,"objectives":1,"bySkill":{"GRAMMAR":1,"WRITING":1}},"totalVocab":0,"recent":[]}
        """)
        XCTAssertEqual(result.totalDue, 1)
        XCTAssertEqual(practiceOptions.first { $0.kind == "FULL" }?.dueCount(in: result), 1)
        XCTAssertEqual(practiceOptions.first { $0.kind == "GRAMMAR" }?.dueCount(in: result), 1)
        XCTAssertEqual(practiceOptions.first { $0.kind == "WRITING" }?.dueCount(in: result), 1)
        XCTAssertEqual(practiceOptions.first { $0.kind == "VOCAB" }?.dueCount(in: result), 0)
        XCTAssertNil(practiceOptions.first { $0.kind == "SPEAKING" }?.dueCount(in: result))
        XCTAssertTrue(result.dueSummary.contains("1 objective"))
        XCTAssertFalse(result.dueSummary.contains("grammar point"))
    }

    func testMixedReviewCountsObjectivesOnceAndPreservesLegacyVocabularyAndGrammar() throws {
        let result = try overview("""
        {"due":{"vocab":4,"grammar":2,"objectives":3,"bySkill":{"GRAMMAR":2,"READING":2,"LISTENING":1,"SPEAKING":1,"WRITING":3}},"totalVocab":40,"recent":[]}
        """)
        XCTAssertEqual(result.totalDue, 9)
        XCTAssertEqual(result.due.count(for: "GRAMMAR"), 4)
        XCTAssertEqual(result.due.count(for: "READING"), 2)
        XCTAssertEqual(result.due.count(for: "LISTENING"), 1)
        XCTAssertEqual(result.due.count(for: "SPEAKING"), 1)
        XCTAssertEqual(result.due.count(for: "WRITING"), 3)
        XCTAssertEqual(result.due.count(for: "VOCAB"), 4)
        XCTAssertTrue(result.dueSummary.contains("4 words"))
        XCTAssertTrue(result.dueSummary.contains("2 legacy grammar points"))
        XCTAssertTrue(result.dueSummary.contains("3 objectives"))
    }

    private func overview(_ json: String) throws -> SottoPracticeOverview {
        try JSONDecoder().decode(SottoPracticeOverview.self, from: Data(json.utf8))
    }

    func testOnlyActiveSessionsWaitForLearnerAnswers() throws {
        let result = try overview(
            """
            {
              "due": { "vocab": 4, "grammar": 2 },
              "totalVocab": 40,
              "recent": [
                { "id": "s1", "kind": "FULL", "status": "ACTIVE", "score": null,
                  "startedAt": "2026-08-22T10:00:00.000Z", "completedAt": null },
                { "id": "s2", "kind": "VOCAB", "status": "COMPLETED", "score": 0.8,
                  "startedAt": "2026-08-21T10:00:00.000Z", "completedAt": "2026-08-21T10:20:00.000Z" },
                { "id": "cancelled", "kind": "VOCAB", "status": "CANCELLED", "completedAt": null },
                { "id": "failed", "kind": "VOCAB", "status": "FAILED", "completedAt": null },
                { "id": "generating", "kind": "VOCAB", "status": "GENERATING", "completedAt": null }
              ]
            }
            """
        )

        XCTAssertEqual(result.unfinished.map(\.id), ["s1"])
        XCTAssertEqual(result.preparing.map(\.id), ["generating"])
        XCTAssertEqual(result.unsuccessful.map(\.id), ["cancelled", "failed"])
        XCTAssertEqual(result.preparing.first?.statusLabel, "Preparing")
        XCTAssertEqual(result.preparing.first?.actionLabel, "View status")
        XCTAssertEqual(result.unsuccessful.map(\.statusLabel), ["Cancelled", "Generation failed"])
        XCTAssertTrue(result.unsuccessful.allSatisfy { $0.actionLabel != "Resume" })
        XCTAssertEqual(result.totalDue, 6)
    }

    func testNothingDueAndNothingOpen() throws {
        let result = try overview(
            """
            { "due": { "vocab": 0, "grammar": 0 }, "totalVocab": 0, "recent": [] }
            """
        )

        XCTAssertEqual(result.totalDue, 0)
        XCTAssertTrue(result.unfinished.isEmpty)
    }

    func testDueCountsAttachToTheKindsThatCarryThem() throws {
        let result = try overview(
            """
            { "due": { "vocab": 4, "grammar": 2 }, "totalVocab": 40, "recent": [] }
            """
        )

        func option(_ kind: String) -> PracticeKindOption {
            practiceOptions.first { $0.kind == kind }!
        }

        XCTAssertEqual(option("FULL").dueCount(in: result), 6)
        XCTAssertEqual(option("VOCAB").dueCount(in: result), 4)
        XCTAssertEqual(option("GRAMMAR").dueCount(in: result), 2)
        XCTAssertNil(option("READING").dueCount(in: result))
        XCTAssertNil(option("SPEAKING").dueCount(in: result))
    }

    func testDeletingLeavesTheOtherSessionsAlone() throws {
        let before = try overview(
            """
            {
              "due": { "vocab": 1, "grammar": 0 },
              "totalVocab": 10,
              "recent": [
                { "id": "s1", "kind": "FULL", "status": "ACTIVE", "score": null,
                  "startedAt": "2026-08-22T10:00:00.000Z", "completedAt": null },
                { "id": "s2", "kind": "FULL", "status": "ACTIVE", "score": null,
                  "startedAt": "2026-08-22T09:00:00.000Z", "completedAt": null }
              ]
            }
            """
        )
        XCTAssertEqual(before.unfinished.map(\.id), ["s1", "s2"])

        // What the panel shows after the server confirms one deletion.
        let after = try overview(
            """
            {
              "due": { "vocab": 1, "grammar": 0 },
              "totalVocab": 10,
              "recent": [
                { "id": "s2", "kind": "FULL", "status": "ACTIVE", "score": null,
                  "startedAt": "2026-08-22T09:00:00.000Z", "completedAt": null }
              ]
            }
            """
        )
        XCTAssertEqual(after.unfinished.map(\.id), ["s2"])
    }

    func testPrismaTimestampsWithFractionalSecondsParse() throws {
        let date = ISO8601DateFormatter.sottoInternet.date(from: "2026-08-22T10:00:00.000Z")
        XCTAssertNotNil(date)
    }
}
