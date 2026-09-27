import PencilKit
import XCTest

@testable import Sotto

final class LearningInkTests: XCTestCase {
    func testInkIsIsolatedByServerLearnerAndActivity() throws {
        let server = try XCTUnwrap(URL(string: "https://school.example"))
        let first = LearningInkStore.scope(server: server, profileID: "alice", activity: "class/1")
        XCTAssertNotEqual(first, LearningInkStore.scope(server: server, profileID: "bob", activity: "class/1"))
        XCTAssertNotEqual(first, LearningInkStore.scope(server: server, profileID: "alice", activity: "class/2"))
        XCTAssertNotEqual(first, LearningInkStore.scope(server: try XCTUnwrap(URL(string: "https://other.example")), profileID: "alice", activity: "class/1"))
    }

    func testSavedInkReopensAndErasingPersists() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        let points = [CGPoint(x: 10, y: 10), CGPoint(x: 50, y: 50)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index), size: CGSize(width: 3, height: 3), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(controlPoints: points, creationDate: Date()))
        try store.save(PKDrawing(strokes: [stroke]), key: "answer")
        let reopened = LearningInkStore(directory: directory)
        XCTAssertEqual(try reopened.load("answer").strokes.count, 1)
        XCTAssertTrue(try reopened.load("another-answer").strokes.isEmpty)
        try reopened.save(PKDrawing(), key: "answer")
        XCTAssertTrue(try store.load("answer").strokes.isEmpty)
    }

    func testCorruptInkSurfacesAnError() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        try store.save(PKDrawing(), key: "answer")
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        try Data("broken ink".utf8).write(to: file)
        XCTAssertThrowsError(try store.load("answer"))
    }

    func testChangedDrawingBytesFailIntegrityValidation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LearningInkStore(directory: directory)
        try store.save(PKDrawing(), key: "answer")
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        var saved = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        saved["drawing"] = Data("unreadable ink".utf8).base64EncodedString()
        try JSONSerialization.data(withJSONObject: saved).write(to: file)
        XCTAssertThrowsError(try store.load("answer")) { error in
            XCTAssertTrue(error is LearningInkStore.StorageError)
        }
    }
}
