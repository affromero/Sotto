import XCTest

@testable import Sotto

final class PlaySafetyContractsTests: XCTestCase {
    func testBundledSafetyContractDecodesPolicyConsentBlocksReportResponseAndAcknowledgment() throws {
        let fixture = try PlaySafetyFixtures.load()
        try fixture.policy.validate()
        XCTAssertEqual(fixture.version, 1)
        XCTAssertEqual(fixture.policy.version, fixture.version)
        XCTAssertTrue(fixture.policy.paragraphs.contains { $0.contains("without AI") })
        XCTAssertEqual(fixture.policy.reviewPath, "/play/safety/review")
        XCTAssertNil(fixture.unaccepted.acceptedVersion)
        XCTAssertNil(fixture.unaccepted.acceptedAt)
        XCTAssertEqual(fixture.accepted.acceptedVersion, 1)
        XCTAssertTrue(fixture.restricted.sharingRestricted)
        XCTAssertEqual(fixture.blocks.blocks.first?.id, "fixture-partner")
        XCTAssertEqual(fixture.report.id, fixture.reportRequest.actionId)
        XCTAssertEqual(fixture.report.status, .resolved)
        XCTAssertNotNil(fixture.report.response)
        XCTAssertEqual(fixture.completed.actionId, fixture.report.id)
        XCTAssertTrue(fixture.completed.completed)
        for failure in fixture.errors {
            XCTAssertEqual(failure.status, failure.body.reason.status)
            XCTAssertFalse([401, 403].contains(failure.status))
        }
        XCTAssertEqual(try JSONDecoder().decode(PlayReportRequest.self,
            from: JSONEncoder().encode(fixture.reportRequest)), fixture.reportRequest)
    }

    func testPartnerNameSelectorOmitsRoundFieldsAndIndexedSelectorsRejectInvalidPositions() throws {
        let name = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(PlayReportSelector.partnerName)) as? [String: String])
        XCTAssertEqual(name, ["kind": "PARTNER_NAME"])
        for invalid in [
            "{\"kind\":\"ROUND_TEXT\",\"roundId\":\"r\",\"field\":\"MESSAGE\"}",
            "{\"kind\":\"ROUND_TEXT\",\"roundId\":\"r\",\"field\":\"HINT\",\"index\":3}",
            "{\"kind\":\"ROUND_TEXT\",\"roundId\":\"r\",\"field\":\"CLUE\",\"index\":0}",
        ] { XCTAssertThrowsError(try JSONDecoder().decode(PlayReportSelector.self, from: Data(invalid.utf8))) }
    }

    func testReportOptionsExposeOnlyOtherAuthoredVisibleTextAndKeepOriginalMessageIndexes() throws {
        let fixture = try PlayTestFixtures.load()
        let hidden = try fixture.room(round: "initial-0-HOST")
        XCTAssertEqual(hidden.reportOptions.map(\.selector), [.partnerName])
        let learner = try fixture.room(round: "clue-2-HOST")
        XCTAssertFalse(learner.reportOptions.contains { option in
            if case .roundText(_, .target, _) = option.selector { return true }
            if case .roundText(_, .clue, _) = option.selector { return true }
            return false
        })
        let partner = try fixture.room("playing-GUEST", round: "clue-2-GUEST")
        XCTAssertTrue(partner.reportOptions.contains { if case .roundText(_, .clue, _) = $0.selector { true } else { false } })
        XCTAssertFalse(partner.reportOptions.contains { if case .roundText(_, .target, _) = $0.selector { true } else { false } })
        let mission = try fixture.room(round: "message-3-4-HOST")
        guard case let .mission(content) = try XCTUnwrap(mission.round).content else { return XCTFail("Expected mission fixture") }
        let messages = mission.reportOptions.filter { if case .roundText(_, .message, _) = $0.selector { true } else { false } }
        XCTAssertFalse(messages.isEmpty)
        for option in messages {
            guard case let .roundText(_, .message, position) = option.selector else { continue }
            let index = try XCTUnwrap(position)
            XCTAssertNotEqual(content.messages[index].seat, mission.ownSeat)
            XCTAssertEqual(content.messages[index].text, option.text)
        }
        XCTAssertFalse(mission.reportOptions.contains { $0.text == content.ownObjective })
        let completed = try fixture.room("playing-GUEST", round: "finished-2-GUEST")
        XCTAssertTrue(completed.reportOptions.contains { if case .roundText(_, .target, _) = $0.selector { true } else { false } })
        XCTAssertFalse(completed.reportOptions.contains { if case .roundText(_, .guess, _) = $0.selector { true } else { false } })
    }
}
