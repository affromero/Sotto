import XCTest
@testable import Sotto

final class ClassGenerationProgressTests: XCTestCase {
    private func progress(updatedAt: String?) throws -> SottoGenerationProgress {
        var payload: [String: Any] = ["status": "GENERATING", "stage": "Generating reading questions", "detail": "Reviewing questions.", "progress": 0.34, "currentStep": 2, "totalSteps": 6, "sections": [], "providerRequestsCompleted": 4, "providerRequestInFlight": true]
        if let updatedAt { payload["updatedAt"] = updatedAt }
        return try JSONDecoder().decode(SottoGenerationProgress.self, from: JSONSerialization.data(withJSONObject: payload))
    }

    func testProgressIncludesObservedActivityAndFractionalTimestamp() throws {
        let now = Date(timeIntervalSince1970: 1_000)
        let value = try progress(updatedAt: "1970-01-01T00:16:30.000Z").loadingOperation(title: "Generating class", elapsedSeconds: 50, now: now)
        XCTAssertEqual(value.progress, 0.34)
        XCTAssertEqual(value.currentStep, 2)
        XCTAssertTrue(value.activity?.contains("4 AI requests completed") == true)
        XCTAssertTrue(value.activity?.contains("Waiting for an AI response") == true)
        XCTAssertTrue(value.activity?.contains("10s ago") == true)
    }

    func testLongSilenceReportsMissingUpdatesWithoutClaimingFailure() throws {
        let value = try progress(updatedAt: "1970-01-01T00:10:00Z").loadingOperation(title: "Generating class", elapsedSeconds: 400, now: Date(timeIntervalSince1970: 1_000))
        XCTAssertTrue(value.activity?.contains("No progress update for 6m 40s") == true)
        XCTAssertTrue(value.activity?.contains("may still be working") == true)
    }

    func testRefreshFailureKeepsLastObservedProgressAndSurfacesConnectionIssue() throws {
        let observed = try progress(updatedAt: nil).loadingOperation(title: "Generating class", elapsedSeconds: 10)
        let value = observed.progressUnavailable(elapsedSeconds: 20)
        XCTAssertEqual(value.progress, 0.34)
        XCTAssertEqual(value.detail, observed.detail)
        XCTAssertEqual(value.elapsedSeconds, 20)
        XCTAssertNil(value.remainingSeconds)
        XCTAssertTrue(value.activity?.contains("Cannot refresh progress") == true)
    }
}
