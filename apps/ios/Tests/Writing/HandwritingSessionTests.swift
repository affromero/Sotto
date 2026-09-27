import PencilKit
import XCTest

@testable import Sotto

@MainActor
final class HandwritingSessionTests: XCTestCase {
    func testEachDrawingChangeIsSavedBeforeTheEditorCloses() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        let session = HandwritingSession(storageKey: "answer", store: store)
        session.activate()
        session.updateDrawing(ink())
        XCTAssertEqual(try store.load("answer").strokes.count, 1)
        XCTAssertTrue(session.isSaved)
        session.updateDrawing(PKDrawing())
        XCTAssertTrue(try store.load("answer").strokes.isEmpty)
    }

    func testClosingFlushesLatestCanvasInkAndReopeningKeepsIt() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        let session = HandwritingSession(storageKey: "answer", store: store)
        session.activate()
        session.deactivate(flushing: ink())
        let reopened = HandwritingSession(storageKey: "answer", store: store)
        reopened.activate()
        XCTAssertEqual(reopened.drawing.strokes.count, 1)
        XCTAssertNotNil(reopened.beginRecognition())
    }

    func testUnreadableSavedInkSurvivesEditsAndClosing() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        try store.save(ink(), key: "answer")
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let corrupted = Data("unreadable ink".utf8)
        try corrupted.write(to: file)
        XCTAssertThrowsError(try store.load("answer"))
        let session = HandwritingSession(storageKey: "answer", store: store)
        session.activate()
        XCTAssertNotNil(session.errorMessage)
        session.updateDrawing(ink())
        session.deactivate(flushing: ink())
        XCTAssertFalse(session.isSaved)
        XCTAssertEqual(try Data(contentsOf: file), corrupted)
    }

    func testChangedOrClearedInkRejectsOldRecognition() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let session = HandwritingSession(storageKey: "answer", store: LearningInkStore(directory: directory))
        session.activate()
        session.updateDrawing(ink())
        let old = try XCTUnwrap(session.beginRecognition())
        session.updateDrawing(PKDrawing())
        session.finishRecognition(old, result: .success("old answer"))
        XCTAssertTrue(session.recognizedText.isEmpty)
        XCTAssertFalse(session.isRecognizing)
    }

    func testRecognitionFromBeforeBackgroundingCannotReplaceANewPreview() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let session = HandwritingSession(storageKey: "answer", store: LearningInkStore(directory: directory))
        session.activate()
        session.updateDrawing(ink())
        let previous = try XCTUnwrap(session.beginRecognition())
        session.deactivate(flushing: session.drawing)
        session.activate()
        let current = try XCTUnwrap(session.beginRecognition())
        session.finishRecognition(current, result: .success("new answer"))
        session.recognizedText = "learner correction"
        session.finishRecognition(previous, result: .success("stale answer"))
        XCTAssertEqual(session.recognizedText, "learner correction")
    }

    func testSaveFailuresAreVisibleAndCanBeRetriedWithoutLosingInk() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data("blocking file".utf8).write(to: directory)
        let session = HandwritingSession(storageKey: "answer", store: LearningInkStore(directory: directory))
        session.activate()
        session.updateDrawing(ink())
        XCTAssertFalse(session.isSaved)
        XCTAssertNotNil(session.errorMessage)
        XCTAssertEqual(session.drawing.strokes.count, 1)
        try FileManager.default.removeItem(at: directory)
        XCTAssertTrue(session.flush(session.drawing))
        XCTAssertNil(session.errorMessage)
        XCTAssertEqual(try LearningInkStore(directory: directory).load("answer").strokes.count, 1)
    }

    func testSuccessfulRecognitionClearsAnEarlierRecognitionFailure() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let session = HandwritingSession(storageKey: "answer", store: LearningInkStore(directory: directory))
        session.activate()
        session.updateDrawing(ink())
        let failed = try XCTUnwrap(session.beginRecognition())
        session.finishRecognition(failed, result: .failure(SottoAPIError.message("Could not read image")))
        XCTAssertNotNil(session.errorMessage)
        let retry = try XCTUnwrap(session.beginRecognition())
        session.finishRecognition(retry, result: .success("answer"))
        XCTAssertEqual(session.recognizedText, "answer")
        XCTAssertNil(session.errorMessage)
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    private func ink() -> PKDrawing {
        let points = [CGPoint(x: 10, y: 10), CGPoint(x: 50, y: 50)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index), size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }
}
