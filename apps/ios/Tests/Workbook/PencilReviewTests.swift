import XCTest
import PencilKit

@testable import Sotto

final class PencilReviewTests: XCTestCase {
    func testChangedInkRequiresReviewEvenWhenThePreviousAnswerIsStillSaved() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PencilReviewStore(directory: directory)
        let drawing = drawing(at: 20)
        var review = PencilReviewStore.Review(inkDigest: LearningInkStore.drawingDigest(drawing), requestId: UUID())
        review.accepted = true
        review.acceptedIndex = 1
        try store.save(review, key: "task")
        let inks = LearningInkStore(directory: directory.appendingPathComponent("ink"))
        try inks.save(drawing, key: "task")
        XCTAssertFalse(try store.requiresReview(drawing: inks.load("task"), key: "task", confirmedAnswer: .choice(1)))
        XCTAssertTrue(try store.requiresReview(drawing: self.drawing(at: 70), key: "task", confirmedAnswer: .choice(1)))
        XCTAssertTrue(try store.requiresReview(drawing: drawing, key: "task", confirmedAnswer: nil))
        XCTAssertFalse(try store.requiresReview(drawing: PKDrawing(), key: "task", confirmedAnswer: .choice(1)))
    }

    private func drawing(at x: CGFloat) -> PKDrawing {
        let points = [CGPoint(x: x, y: 80), CGPoint(x: x + 20, y: 100)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index), size: CGSize(width: 5, height: 5), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .blue), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }

    func testReviewedAnswerAndRequestIdentitySurviveReopeningForTheSameInk() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = PencilReviewStore(directory: directory)
        var review = PencilReviewStore.Review(inkDigest: "original", requestId: UUID())
        review.image = "data:image/png;base64,aW5r"
        try store.save(review, key: "learner-class-task")
        XCTAssertEqual(try store.load(key: "learner-class-task")?.requestId, review.requestId)
        review.accepted = true
        review.acceptedText = "Ich habe ein Picknick gemacht."
        try store.save(review, key: "learner-class-task")
        let reopened = try XCTUnwrap(store.load(key: "learner-class-task"))
        XCTAssertTrue(reopened.accepted)
        XCTAssertEqual(reopened.acceptedText, review.acceptedText)
        XCTAssertEqual(reopened.inkDigest, "original")
        XCTAssertEqual(reopened.image, review.image)
        XCTAssertNil(try store.load(key: "other-learner-class-task"))
    }

    func testImageInterpretationPreservesAmbiguityForLearnerReview() throws {
        let response = try JSONDecoder().decode(SottoPencilInterpretation.self, from: Data(#"{"status":"READY","operationId":"f9405b45-2d21-42a4-9d01-9f4eb1c6fa48","proposal":{"selectedIndex":null,"text":"Ich habe gemacht.","observations":["A crossed-out verb was replaced."],"uncertainties":["The inserted noun is unclear."]}}"#.utf8))
        XCTAssertEqual(response.status, "READY")
        XCTAssertNil(response.proposal?.selectedIndex)
        XCTAssertEqual(response.proposal?.uncertainties, ["The inserted noun is unclear."])
        XCTAssertEqual(response.proposal?.text, "Ich habe gemacht.")
    }
}
