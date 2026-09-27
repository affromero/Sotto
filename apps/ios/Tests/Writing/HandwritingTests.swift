import PencilKit
import UIKit
import XCTest

@testable import Sotto

@MainActor
final class HandwritingTests: XCTestCase {
    func testPaperResizesWithoutDistortingInkCoordinates() {
        let canvas = PKCanvasView()
        let paper = InkPaperView(canvas: canvas, pageSize: CGSize(width: 800, height: 600))
        paper.frame = CGRect(x: 0, y: 0, width: 400, height: 600)
        paper.layoutIfNeeded()
        XCTAssertEqual(canvas.bounds.size, CGSize(width: 800, height: 600))
        XCTAssertEqual(canvas.transform.a, canvas.transform.d, accuracy: 0.001)
        XCTAssertEqual(canvas.frame.width, 400, accuracy: 0.001)
        XCTAssertEqual(canvas.frame.height, 300, accuracy: 0.001)
        paper.frame = CGRect(x: 0, y: 0, width: 900, height: 300)
        paper.layoutIfNeeded()
        XCTAssertEqual(canvas.bounds.size, CGSize(width: 800, height: 600))
        XCTAssertEqual(canvas.transform.a, canvas.transform.d, accuracy: 0.001)
        XCTAssertEqual(canvas.frame.height, 300, accuracy: 0.001)
    }

    func testOnDeviceRecognitionReturnsReviewableText() async throws {
        let image = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 160)).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 160))
            ("Bonjour Paris" as NSString).draw(at: CGPoint(x: 30, y: 30), withAttributes: [
                .font: UIFont.systemFont(ofSize: 64), .foregroundColor: UIColor.black,
            ])
        }
        let text = try await HandwritingRecognition.read(XCTUnwrap(image.cgImage))
        XCTAssertTrue(text.lowercased().contains("bonjour"), text)
        XCTAssertTrue(text.lowercased().contains("paris"), text)
    }
}
