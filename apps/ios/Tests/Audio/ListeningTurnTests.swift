import XCTest

@testable import Sotto

final class ListeningTurnTests: XCTestCase {
    func testSpeakerChangesAtExactTurnBoundariesAndGapsHaveNoSpeaker() {
        let mia = turn("Mia", start: 0, duration: 3)
        let leo = turn("Leo", start: 3.5, duration: 2)
        XCTAssertTrue(mia.contains(time: 0))
        XCTAssertTrue(mia.contains(time: 2.9))
        XCTAssertFalse(mia.contains(time: 3))
        XCTAssertFalse(leo.contains(time: 3.2))
        XCTAssertTrue(leo.contains(time: 3.5))
        XCTAssertFalse(leo.contains(time: 5.5))
    }

    func testMissingOrInvalidTimingsNeverInventTheCurrentSpeaker() {
        for (start, duration) in [(nil, 2.0), (0.0, nil), (-1.0, 3.0), (0.0, 0.0), (.infinity, 2.0), (0.0, .infinity)] as [(Double?, Double?)] {
            XCTAssertFalse(turn("Mia", start: start, duration: duration).contains(time: 1))
        }
        XCTAssertFalse(turn("Mia", start: 0, duration: 2).contains(time: .nan))
    }

    private func turn(_ speaker: String, start: Double?, duration: Double?) -> SottoListeningTurn {
        SottoListeningTurn(id: speaker, speaker: speaker, text: nil, audioUrl: nil, order: 0, startTime: start, duration: duration)
    }
}
