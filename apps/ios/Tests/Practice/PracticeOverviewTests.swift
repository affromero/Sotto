import XCTest

@testable import Sotto

final class PracticeOverviewTests: XCTestCase {
    private func overview(_ json: String) throws -> SottoPracticeOverview {
        try JSONDecoder().decode(SottoPracticeOverview.self, from: Data(json.utf8))
    }

    func testUnfinishedSessionsAreTheOnesWithoutACompletionTime() throws {
        let result = try overview(
            """
            {
              "due": { "vocab": 4, "grammar": 2 },
              "totalVocab": 40,
              "recent": [
                { "id": "s1", "kind": "FULL", "status": "IN_PROGRESS", "score": null,
                  "startedAt": "2026-08-22T10:00:00.000Z", "completedAt": null },
                { "id": "s2", "kind": "VOCAB", "status": "DONE", "score": 0.8,
                  "startedAt": "2026-08-21T10:00:00.000Z", "completedAt": "2026-08-21T10:20:00.000Z" }
              ]
            }
            """
        )

        XCTAssertEqual(result.unfinished.map(\.id), ["s1"])
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
                { "id": "s1", "kind": "FULL", "status": "IN_PROGRESS", "score": null,
                  "startedAt": "2026-08-22T10:00:00.000Z", "completedAt": null },
                { "id": "s2", "kind": "FULL", "status": "IN_PROGRESS", "score": null,
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
                { "id": "s2", "kind": "FULL", "status": "IN_PROGRESS", "score": null,
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
