import PDFKit
import PencilKit
import XCTest

@testable import Sotto

@MainActor
final class WorkbookTests: XCTestCase {
    func testWorkbookInkReopensAndStaysWithinItsDocument() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let pdf = makePDF()
        let store = WorkbookAnnotationStore(directory: directory)
        store.load(pdfData: pdf, documentID: "first")
        store.record(drawing: drawing(), canvasSize: CGSize(width: 200, height: 300), forPageAt: 0)
        let reopened = WorkbookAnnotationStore(directory: directory)
        reopened.load(pdfData: pdf, documentID: "first")
        XCTAssertEqual(reopened.drawing(forPageAt: 0).strokes.count, 1)
        reopened.load(pdfData: pdf, documentID: "second")
        XCTAssertTrue(reopened.drawing(forPageAt: 0).strokes.isEmpty)
        reopened.load(pdfData: pdf, documentID: "first")
        reopened.record(drawing: PKDrawing(), canvasSize: CGSize(width: 200, height: 300), forPageAt: 0)
        let erased = WorkbookAnnotationStore(directory: directory)
        erased.load(pdfData: pdf, documentID: "first")
        XCTAssertTrue(erased.drawing(forPageAt: 0).strokes.isEmpty)
    }

    func testCorruptPageInkIsPreservedWhenNewNotesAreMade() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let pdf = makePDF()
        let store = WorkbookAnnotationStore(directory: directory)
        store.load(pdfData: pdf, documentID: "document")
        store.record(drawing: drawing(), canvasSize: CGSize(width: 200, height: 300), forPageAt: 0)
        let file = directory.appendingPathComponent("document.json")
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var pages = try XCTUnwrap(object["pages"] as? [[String: Any]])
        pages[0]["drawingData"] = Data("corrupt drawing".utf8).base64EncodedString()
        object["pages"] = pages
        let corrupted = try JSONSerialization.data(withJSONObject: object)
        try corrupted.write(to: file)
        let reopened = WorkbookAnnotationStore(directory: directory)
        reopened.load(pdfData: pdf, documentID: "document")
        XCTAssertNotNil(reopened.saveError)
        reopened.record(drawing: drawing(), canvasSize: CGSize(width: 200, height: 300), forPageAt: 0)
        XCTAssertEqual(try Data(contentsOf: file), corrupted)
        let export = try reopened.exportAnnotatedPDF(title: "Recovered notes")
        defer { try? FileManager.default.removeItem(at: export) }
        XCTAssertNotNil(PDFDocument(url: export))
    }

    func testExportPreservesRotatedPageSizeAndVisibleInk() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = try XCTUnwrap(PDFDocument(data: makePDF()))
        source.page(at: 0)?.rotation = 90
        let store = WorkbookAnnotationStore(directory: directory)
        store.load(pdfData: try XCTUnwrap(source.dataRepresentation()), documentID: "rotated")
        let plainURL = try store.exportAnnotatedPDF(title: "Plain")
        defer { try? FileManager.default.removeItem(at: plainURL) }
        store.record(drawing: drawing(), canvasSize: CGSize(width: 300, height: 200), forPageAt: 0)
        let inkURL = try store.exportAnnotatedPDF(title: "Ink")
        defer { try? FileManager.default.removeItem(at: inkURL) }
        XCTAssertTrue(plainURL.isFileURL, "Export shares a local PDF without requiring Safari authentication.")
        XCTAssertTrue(inkURL.isFileURL, "Annotated exports must also be shareable without server credentials.")
        let plain = try XCTUnwrap(PDFDocument(url: plainURL)?.page(at: 0))
        let ink = try XCTUnwrap(PDFDocument(url: inkURL)?.page(at: 0))
        XCTAssertEqual(ink.bounds(for: .mediaBox).size, CGSize(width: 300, height: 200))
        XCTAssertTrue(ink.string?.contains("Write here") == true)
        let size = CGSize(width: 300, height: 200)
        XCTAssertNotEqual(plain.thumbnail(of: size, for: .mediaBox).pngData(), ink.thumbnail(of: size, for: .mediaBox).pngData())
    }

    private func temporaryDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }

    private func makePDF() -> Data {
        let bounds = CGRect(x: 0, y: 0, width: 200, height: 300)
        return UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
            context.beginPage()
            UIColor.white.setFill()
            context.fill(bounds)
            ("Write here" as NSString).draw(at: CGPoint(x: 15, y: 15), withAttributes: [.font: UIFont.systemFont(ofSize: 15)])
        }
    }

    private func drawing() -> PKDrawing {
        let points = [CGPoint(x: 40, y: 80), CGPoint(x: 150, y: 120)].enumerated().map { index, point in
            PKStrokePoint(location: point, timeOffset: Double(index), size: CGSize(width: 8, height: 8), opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
        }
        return PKDrawing(strokes: [PKStroke(ink: PKInk(.pen, color: .red), path: PKStrokePath(controlPoints: points, creationDate: Date()))])
    }
}
