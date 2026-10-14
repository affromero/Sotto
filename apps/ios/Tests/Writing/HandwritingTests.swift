import PencilKit
import UIKit
import XCTest
import CoreImage

@testable import Sotto

@MainActor
final class HandwritingTests: XCTestCase {
    func testPrintedPaperStaysVisibleInTheSameResizedAreaAsTheInk() throws {
        let background = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 600)).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 800, height: 600))
        }
        let canvas = PKCanvasView()
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        let paper = InkPaperView(canvas: canvas, pageSize: background.size, backgroundImage: background)
        paper.frame = CGRect(x: 0, y: 0, width: 400, height: 600)
        paper.layoutIfNeeded()
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let snapshot = UIGraphicsImageRenderer(size: paper.bounds.size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(paper.bounds)
            paper.layer.render(in: context.cgContext)
        }
        let image = try XCTUnwrap(snapshot.cgImage)
        func pixel(at point: CGPoint) -> [UInt8] {
            var bytes = [UInt8](repeating: 0, count: 4)
            bytes.withUnsafeMutableBytes { buffer in
                CIContext().render(CIImage(cgImage: image), toBitmap: buffer.baseAddress!, rowBytes: 4,
                    bounds: CGRect(origin: point, size: CGSize(width: 1, height: 1)), format: .RGBA8,
                    colorSpace: CGColorSpaceCreateDeviceRGB())
            }
            return bytes
        }
        let center = pixel(at: CGPoint(x: 200, y: 300))
        let edge = pixel(at: CGPoint(x: 10, y: 10))
        XCTAssertGreaterThan(center[2], 200)
        XCTAssertLessThan(center[0], 20)
        XCTAssertGreaterThan(edge[0], 240)
    }

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
