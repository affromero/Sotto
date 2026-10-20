import XCTest

@testable import Sotto

final class PlayContractsTests: XCTestCase {
    func testAllCanonicalPersonalizedRoundsDecodeAndOfferOnlyAuthorizedNotebookText() throws {
        let fixture = try PlayTestFixtures.load()
        for entry in fixture.rounds {
            XCTAssertEqual(entry.round.visibleTexts, entry.visibleTexts, entry.name)
            if case let .prediction(prediction) = entry.round.content, prediction.questionStyle == .choices {
                XCTAssertEqual(prediction.answerLabel("A"), prediction.choices.first(where: { $0.id == .A })?.text)
            }
            if case let .mission(mission) = entry.round.content, !entry.round.revealed {
                XCTAssertNil(mission.otherObjective)
                XCTAssertNil(mission.otherOutcome)
            }
        }
        let encoded = try JSONEncoder().encode(fixture.rounds.map(\.round))
        XCTAssertEqual(try JSONDecoder().decode([PlayRound].self, from: encoded), fixture.rounds.map(\.round))
        XCTAssertEqual(Set(fixture.rooms.map { $0.room.ownMember?.id }), ["host-profile", "guest-profile"])
    }

    func testIncomingLinksResolveOnlyVersionedCredentialFreeGameDestinations() throws {
        let invite = try PlayInvitation(serverURL: URL(string: "https://school.example")!, code: "abcd-efgh-jk23")
        XCTAssertEqual(PlayInvitation.parse(invite.appURL.absoluteString), invite)
        XCTAssertEqual(PlayInvitation.parse(invite.webURL.absoluteString), invite)
        XCTAssertEqual(PlayInvitation.parse("https://sotto.fm/play/join?v=1&server=https%3A%2F%2Fschool.example&code=ABCDEFGHJK23"), invite)
        for bad in [
            "sotto://play/join?v=2&server=https://school.example&code=ABCDEFGHJK23",
            "sotto://play/join?v=1&v=1&server=https://school.example&code=ABCDEFGHJK23",
            "sotto://play/join?v=1&server=https://secret@school.example&code=ABCDEFGHJK23",
            "sotto://play/join?v=1&server=https://school.example/path&code=ABCDEFGHJK23",
            "sotto://play/join?v=1&server=http://public.example&code=ABCDEFGHJK23",
            "https://evil.example/play/join?v=1&server=https://school.example&code=ABCDEFGHJK23",
            "https://school.example/play/join?v=1&code=ABCDEFGHJK23#secret",
            "sotto://play/join?v=1&server=https://school.example&code=ABCDEFGHJK23&token=private",
        ] { XCTAssertNil(PlayInvitation.parse(bad), bad) }
        XCTAssertNotNil(PlayInvitation.parse("sotto://play/join?v=1&server=http://127.0.0.1:3000&code=ABCDEFGHJK23"))
    }

    func testFeedbackEncodesExplicitNullAndIndependentPicksEncodeOptionIDs() throws {
        let commands: [PlayCommand] = [.feedback(understood: true, correction: nil), .choose(.B)]
        let data = try JSONEncoder().encode(commands)
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        XCTAssertTrue(payload[0]["correction"] is NSNull)
        XCTAssertEqual(payload[1]["optionId"] as? String, "B")
        XCTAssertNil(payload[1]["text"])
        XCTAssertEqual(try JSONDecoder().decode([PlayCommand].self, from: data), commands)
    }
}
