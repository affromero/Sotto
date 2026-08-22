import XCTest

@testable import Sotto

@MainActor
final class WritingDraftStoreTests: XCTestCase {
    /// Prompts only arrive decoded from the server, so build them that way.
    private func prompt(id: String, previousText: String? = nil, score: Double? = nil) throws -> SottoWritingPrompt {
        var responses = "null"
        if let previousText {
            let text = String(data: try JSONEncoder().encode(previousText), encoding: .utf8) ?? "\"\""
            let scoreJSON = score.map { String($0) } ?? "null"
            responses = "[{\"text\": " + text + ", \"overallScore\": " + scoreJSON
                + ", \"corrections\": [], \"feedback\": \"\"}]"
        }

        let json = "{\"id\": \"" + id + "\", \"order\": 1, \"task\": \"Write something\", "
            + "\"guidance\": null, \"responses\": " + responses + "}"
        return try JSONDecoder().decode(SottoWritingPrompt.self, from: Data(json.utf8))
    }

    func testAnUntouchedPromptIsNotResent() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Ich bin gestern gegangen.", score: 0.8))

        XCTAssertFalse(store.hasChanges)
        XCTAssertTrue(store.changedPromptIds.isEmpty)
    }

    func testEditingAGradedAnswerMarksItForSubmission() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Ich bin gegangen.", score: 0.8))

        store.binding(for: "p1").wrappedValue = "Ich bin nach Berlin gegangen."

        XCTAssertTrue(store.hasChanges)
        XCTAssertEqual(store.changedPromptIds, ["p1"])
    }

    func testOnlyTheEditedPromptIsSent() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Fertig.", score: 0.9))
        store.register(try prompt(id: "p2", previousText: "Auch fertig.", score: 0.7))

        store.binding(for: "p2").wrappedValue = "Doch nicht fertig."

        XCTAssertEqual(store.changedPromptIds, ["p2"])
    }

    func testWhitespaceOnlyEditsAreNotChanges() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Fertig.", score: 0.9))

        store.binding(for: "p1").wrappedValue = "  Fertig.  "

        XCTAssertFalse(store.hasChanges)
    }

    func testAnEmptyAnswerIsNeverSubmitted() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))

        XCTAssertFalse(store.hasChanges)

        store.binding(for: "p1").wrappedValue = "   "
        XCTAssertFalse(store.hasChanges)
    }

    func testAnswersOverTheRouteLimitAreHeldBack() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))

        store.binding(for: "p1").wrappedValue = String(repeating: "a", count: 4001)

        XCTAssertTrue(store.isOverLimit)
        XCTAssertFalse(store.hasChanges)
    }

    func testRegisteringAgainKeepsTyping() throws {
        let store = WritingDraftStore()
        let p = try prompt(id: "p1")
        store.register(p)
        store.binding(for: "p1").wrappedValue = "Halb geschrieben"

        store.register(p)

        XCTAssertEqual(store.draft(for: "p1")?.text, "Halb geschrieben")
    }
}
