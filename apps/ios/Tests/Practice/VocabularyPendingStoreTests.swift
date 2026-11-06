import XCTest
@testable import Sotto

final class VocabularyPendingStoreTests: XCTestCase {
    func testUncertainVocabularyResponseSurvivesReopeningAndCannotBeReplaced() throws {
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: UUID().uuidString)
        let store = VocabularyPendingStore(client: client, scope: "action/study")
        defer { try? store.clear() }
        let response = SottoVocabularyAction(action: "ANSWER", expectedRevision: 4, itemId: "card", answer: "house")
        try store.save(response)
        let reopened = VocabularyPendingStore(client: client, scope: "action/study")
        XCTAssertEqual(try reopened.load(SottoVocabularyAction.self), response)
        XCTAssertThrowsError(try reopened.save(SottoVocabularyAction(action: "ANSWER", expectedRevision: 4, itemId: "card", answer: "home")))
        XCTAssertEqual(try reopened.load(SottoVocabularyAction.self), response)
        try reopened.clear()
        XCTAssertNil(try store.load(SottoVocabularyAction.self))
    }

    func testPendingAdmissionsAreScopedToTheLearnerAndCourse() throws {
        let profile = UUID().uuidString
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: profile)
        let other = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: UUID().uuidString)
        let first = VocabularyPendingStore(client: client, scope: "admission/course-a")
        let anotherCourse = VocabularyPendingStore(client: client, scope: "admission/course-b")
        let anotherLearner = VocabularyPendingStore(client: other, scope: "admission/course-a")
        defer { try? first.clear(); try? anotherCourse.clear(); try? anotherLearner.clear() }
        let request = SottoVocabularyAdmission(requestId: UUID().uuidString, mode: .word, wordIds: ["word"])
        try first.save(request)
        XCTAssertEqual(try first.load(SottoVocabularyAdmission.self), request)
        XCTAssertNil(try anotherCourse.load(SottoVocabularyAdmission.self))
        XCTAssertNil(try anotherLearner.load(SottoVocabularyAdmission.self))
    }

    func testInterruptedCompletionAndDraftRemainDiscoverableForTheirCourse() throws {
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key", profileId: UUID().uuidString)
        let action = VocabularyPendingStore(client: client, scope: "action/course/study")
        let draft = VocabularyPendingStore(client: client, scope: "draft/course/study")
        defer { try? action.clear(); try? draft.clear() }
        try action.save(SottoVocabularyAction(action: "COMPLETE", expectedRevision: 4))
        try draft.replace(["card": "house"])
        XCTAssertEqual(try action.pendingSessions(courseId: "course"), ["study"])
        try action.clear()
        XCTAssertEqual(try action.pendingSessions(courseId: "course"), ["study"])
        try draft.clear()
        XCTAssertTrue(try action.pendingSessions(courseId: "course").isEmpty)
    }
}
