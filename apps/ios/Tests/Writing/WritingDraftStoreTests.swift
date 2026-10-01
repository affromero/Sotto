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

    func testConfirmedWritingFailureCanRetryTheSameAnswerThroughCanonicalAdmission() async throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))
        store.binding(for: "p1").wrappedValue = "Hola."
        let rejected = await store.submit(source: .practice(sessionId: "session"), loadLatest: { _ in nil },
            grade: { _, _ in throw SottoAPIError.message("Provider rejected the request.") })
        XCTAssertFalse(rejected)
        let recovered = await store.submit(source: .practice(sessionId: "session"), loadLatest: { _ in nil },
            grade: { _, answer in
                XCTAssertEqual(answer, "Hola.")
                return SottoWritingGrade(overallScore: 0.9, corrections: [], feedback: "Clear")
            })
        XCTAssertTrue(recovered)
        XCTAssertEqual(store.draft(for: "p1")?.grade?.feedback, "Clear")
        XCTAssertNil(store.draft(for: "p1")?.unknownText)
    }

    func testSavedGradeRecoversLostAcknowledgementWithoutAnotherGradeRequest() async throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))
        store.binding(for: "p1").wrappedValue = "Hola."
        let first = await store.submit(source: .classSession(classId: "class"), loadLatest: { _ in nil },
            grade: { _, _ in throw URLError(.networkConnectionLost) })
        XCTAssertFalse(first)
        let saved = try prompt(id: "p1", previousText: "Hola.", score: 0.9)
        let recovered = await store.submit(source: .classSession(classId: "class"), loadLatest: { _ in saved },
            grade: { _, _ in
                XCTFail("A saved grade must be restored without dispatching another request.")
                throw URLError(.badServerResponse)
            })
        XCTAssertTrue(recovered)
        XCTAssertFalse(store.hasChanges)
        XCTAssertEqual(store.draft(for: "p1")?.grade?.overallScore, 0.9)
    }

    func testUnresolvedWritingAdmissionKeepsTheAnswerAndItsRecoveryFence() async throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))
        store.binding(for: "p1").wrappedValue = "Hola."
        let first = await store.submit(source: .practice(sessionId: "session"), loadLatest: { _ in nil },
            grade: { _, _ in throw URLError(.networkConnectionLost) })
        XCTAssertFalse(first)
        let unresolved = await store.submit(source: .practice(sessionId: "session"), loadLatest: { _ in nil },
            grade: { _, _ in throw SottoAPIError.message("The previous writing request is unresolved.") })
        XCTAssertFalse(unresolved)
        XCTAssertEqual(store.draft(for: "p1")?.text, "Hola.")
        XCTAssertEqual(store.draft(for: "p1")?.unknownText, "Hola.")
        XCTAssertTrue(store.errorMessage?.contains("unresolved") == true)
        XCTAssertNil(store.draft(for: "p1")?.grade)
    }

    func testAnUnconfirmedExamGradeCannotBeDispatchedAgain() async throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))
        store.binding(for: "p1").wrappedValue = "Hola."
        let first = await store.submit(source: .exam(examId: "exam"), loadLatest: { _ in nil },
            grade: { _, _ in throw URLError(.networkConnectionLost) })
        XCTAssertFalse(first)
        let unresolved = await store.submit(source: .exam(examId: "exam"), loadLatest: { _ in nil },
            grade: { _, _ in
                XCTFail("An exam does not have canonical replay admission.")
                throw URLError(.badServerResponse)
            })
        XCTAssertFalse(unresolved)
        XCTAssertEqual(store.draft(for: "p1")?.unknownText, "Hola.")
    }

    func testRestoredUngradedClassAnswerIsRecoveredWhenFinishing() async throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Hola.", score: nil))
        XCTAssertTrue(store.hasChanges)
        XCTAssertNil(store.draft(for: "p1")?.submittedText)
        let recovered = await store.submit(source: .classSession(classId: "class"),
            loadLatest: { _ in nil }, grade: { _, answer in
                XCTAssertEqual(answer, "Hola.")
                return SottoWritingGrade(overallScore: 0.9, corrections: [], feedback: "Recovered")
            })
        XCTAssertTrue(recovered)
        XCTAssertFalse(store.hasChanges)
        XCTAssertEqual(store.draft(for: "p1")?.grade?.feedback, "Recovered")
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

    func testRestoredDraftKeepsFormattingAndRequiresItsOwnGrade() throws {
        var restored = try prompt(id: "p1", previousText: "Hola.", score: 0.9)
        restored.savedDraft = "Buenas tardes.\nAna."
        let store = WritingDraftStore()
        store.register(restored)
        XCTAssertEqual(store.draft(for: "p1")?.text, "Buenas tardes.\nAna.")
        XCTAssertNil(store.draft(for: "p1")?.grade)
        XCTAssertEqual(store.changedPromptIds, ["p1"])
    }

    func testCanonicalResponseRestoresCorrectionsWithoutResubmission() throws {
        let restored = try JSONDecoder().decode(SottoWritingPrompt.self, from: Data(
            #"{"id":"p1","task":"Greet Ana","savedDraft":"  Hola.  ","response":{"text":"Hola.","overallScore":0.9,"corrections":[{"old":"Ola","new":"Hola","why":"Use the greeting."}],"feedback":"Clear"}}"#.utf8))
        let store = WritingDraftStore()
        store.register(restored)
        XCTAssertEqual(store.draft(for: "p1")?.grade?.corrections.first?.why, "Use the greeting.")
        XCTAssertFalse(store.hasChanges)
    }

    func testFreshServerFeedbackRecoversAnUnacknowledgedMatchingGrade() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1"))
        store.binding(for: "p1").wrappedValue = "Hola."
        store.register(try prompt(id: "p1", previousText: "Hola.", score: 0.9))
        XCTAssertEqual(store.draft(for: "p1")?.grade?.overallScore, 0.9)
        XCTAssertFalse(store.hasChanges)
    }

    func testFreshServerFeedbackDoesNotReplaceAnEditedLocalDraft() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "p1", previousText: "Hola.", score: 0.9))
        store.binding(for: "p1").wrappedValue = "Buenas tardes."
        store.register(try prompt(id: "p1", previousText: "Hola.", score: 0.9))
        XCTAssertEqual(store.draft(for: "p1")?.text, "Buenas tardes.")
        XCTAssertNil(store.draft(for: "p1")?.grade)
        XCTAssertTrue(store.hasChanges)
    }

    func testRegisteringAgainKeepsTyping() throws {
        let store = WritingDraftStore()
        let p = try prompt(id: "p1")
        store.register(p)
        store.binding(for: "p1").wrappedValue = "Halb geschrieben"

        store.register(p)

        XCTAssertEqual(store.draft(for: "p1")?.text, "Halb geschrieben")
    }

    func testReviewedHandwritingBecomesAnEditableAnswerWithoutSubmitting() throws {
        let store = WritingDraftStore()
        store.register(try prompt(id: "handwritten"))
        store.binding(for: "handwritten").wrappedValue = "Ich lerne Deutsch."
        XCTAssertEqual(store.draft(for: "handwritten")?.text, "Ich lerne Deutsch.")
        XCTAssertNil(store.draft(for: "handwritten")?.submittedText)
        XCTAssertNil(store.draft(for: "handwritten")?.grade)
        XCTAssertEqual(store.changedPromptIds, ["handwritten"])
    }
}
