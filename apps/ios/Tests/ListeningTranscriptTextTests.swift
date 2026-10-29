import XCTest

@testable import Sotto

final class ListeningTranscriptTextTests: XCTestCase {
    func testVocabularyMarkersShowTheirWordsInTheConversation() {
        XCTAssertEqual(
            ListeningTranscriptText.display("[V9:Meiner Meinung nach] können wir [V7:arbeiten], wie [V5:gestern]."),
            "Meiner Meinung nach können wir arbeiten, wie gestern."
        )
    }

    func testUnmarkedTextAndMalformedMarkersRemainVisible() {
        let text = "[V:leer] [V1:] [1] [Text]"
        XCTAssertEqual(ListeningTranscriptText.display(text), text)
        XCTAssertEqual(ListeningTranscriptText.display("Ein ganz normaler Satz."), "Ein ganz normaler Satz.")
        XCTAssertEqual(ListeningTranscriptText.display("[V3:unclosed"), "[V3:unclosed")
    }
}
