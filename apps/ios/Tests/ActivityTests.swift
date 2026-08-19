import XCTest

@testable import Sotto

final class ActivityTests: XCTestCase {
    private func activity(from json: String) throws -> SottoActivity {
        try JSONDecoder().decode(SottoActivity.self, from: Data(json.utf8))
    }

    private let sample = """
    {
      "timeZone": "America/Bogota",
      "todayIso": "2026-08-18",
      "days": {
        "2026-08-17": { "class": 1, "vocab": 3 },
        "2026-08-18": { "speaking": 1 }
      },
      "currentStreak": 2,
      "longestStreak": 9
    }
    """

    func testActivityDecodes() throws {
        let activity = try activity(from: sample)

        XCTAssertEqual(activity.timeZone, "America/Bogota")
        XCTAssertEqual(activity.currentStreak, 2)
        XCTAssertEqual(activity.days.count, 2)
    }

    func testTotalSumsEveryCategoryOnADay() throws {
        let activity = try activity(from: sample)

        XCTAssertEqual(activity.total(on: "2026-08-17"), 4)
        XCTAssertEqual(activity.total(on: "2026-08-18"), 1)
    }

    /// Quiet days are absent from the payload rather than sent as zero.
    func testQuietDayCountsAsNothing() throws {
        let activity = try activity(from: sample)

        XCTAssertEqual(activity.total(on: "2026-08-16"), 0)
        XCTAssertNil(activity.dominantCategory(on: "2026-08-16"))
    }

    func testDominantCategoryIsTheBusiestOne() throws {
        let activity = try activity(from: sample)

        XCTAssertEqual(activity.dominantCategory(on: "2026-08-17"), "vocab")
    }

    /// A tie must resolve the same way every load, or the cell changes colour
    /// on refresh for no reason the learner can see.
    func testTiedCategoriesResolveStably() throws {
        let activity = try activity(
            from: """
            {
              "timeZone": "UTC",
              "todayIso": "2026-08-18",
              "days": { "2026-08-18": { "vocab": 2, "class": 2, "exam": 2 } },
              "currentStreak": 1,
              "longestStreak": 1
            }
            """
        )

        let first = activity.dominantCategory(on: "2026-08-18")
        XCTAssertEqual(first, "class")
        XCTAssertEqual(activity.dominantCategory(on: "2026-08-18"), first)
    }

    func testEmptyHistoryDecodes() throws {
        let activity = try activity(
            from: """
            { "timeZone": "UTC", "todayIso": "2026-08-18", "days": {}, "currentStreak": 0, "longestStreak": 0 }
            """
        )

        XCTAssertTrue(activity.days.isEmpty)
        XCTAssertEqual(activity.total(on: "2026-08-18"), 0)
    }
}
