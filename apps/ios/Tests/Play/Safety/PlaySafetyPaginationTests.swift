import XCTest

@testable import Sotto

@MainActor
final class PlaySafetyPaginationTests: XCTestCase {
    func testLoadedOlderBlocksAndReportsSurviveOrdinaryPollingAndResetAfterAcknowledgedUnblock() async throws {
        let fixture = try PlaySafetyFixtures.load()
        let firstBlock = try XCTUnwrap(fixture.blocks.blocks.first)
        let olderBlock = PlayBlock(blockedUserId: "older-partner", name: "Earlier partner", createdAt: firstBlock.createdAt)
        let firstReport = fixture.report
        let olderReport = PlaySafetyReport(id: UUID(), roomId: firstReport.roomId, category: .other,
            detail: "An earlier report", evidence: firstReport.evidence, status: .open, revision: 0,
            createdAt: firstReport.createdAt, response: nil, respondedAt: nil)
        let firstReportCursor = firstReport.id.uuidString
        let olderReportCursor = olderReport.id.uuidString
        let scenario = PlayHTTPScenario()
        scenario.set("GET /api/v1/play/safety/blocks", [try .json(PlayBlockList(blocks: [firstBlock], nextCursor: "block-page-2"))])
        scenario.set("GET /api/v1/play/safety/blocks?beforeId=block-page-2", [try .json(PlayBlockList(blocks: [olderBlock], nextCursor: "block-page-3"))])
        scenario.set("GET /api/v1/play/safety/reports", [try .json(PlaySafetyReportList(reports: [firstReport], nextCursor: firstReportCursor))])
        scenario.set("GET /api/v1/play/safety/reports?beforeId=\(firstReportCursor)", [try .json(PlaySafetyReportList(reports: [olderReport], nextCursor: olderReportCursor))])
        scenario.handle("POST /api/v1/play/safety/blocks/older-partner/unblock") { playSafetyCompleted($0) }
        let harness = try await PlaySafetyHarness.start(scenario: scenario)
        defer { harness.stop() }
        let coordinator = harness.coordinator
        try await waitForPlay("The first pages are visible") { coordinator.blocks == [firstBlock] && coordinator.safetyReports == [firstReport] }
        try await coordinator.loadOlderSafety(blocked: true)
        try await coordinator.loadOlderSafety(blocked: false)
        XCTAssertEqual(coordinator.blocks, [firstBlock, olderBlock])
        XCTAssertEqual(coordinator.safetyReports, [firstReport, olderReport])
        XCTAssertEqual(coordinator.blocksCursor, "block-page-3")
        XCTAssertEqual(coordinator.safetyReportsCursor, olderReportCursor)
        try await coordinator.refresh(coordinator.epoch)
        XCTAssertEqual(coordinator.blocks, [firstBlock, olderBlock])
        XCTAssertEqual(coordinator.safetyReports, [firstReport, olderReport])
        XCTAssertEqual(coordinator.blocksCursor, "block-page-3")
        XCTAssertEqual(coordinator.safetyReportsCursor, olderReportCursor)
        try await coordinator.unblock(olderBlock)
        XCTAssertEqual(coordinator.blocks, [firstBlock])
        XCTAssertEqual(coordinator.safetyReports, [firstReport])
        XCTAssertEqual(coordinator.blocksCursor, "block-page-2")
        XCTAssertEqual(coordinator.safetyReportsCursor, firstReportCursor)
        XCTAssertNil(try harness.vault.load().pendingSafety)
    }
}
