import SwiftUI
import UIKit
import XCTest

@testable import Sotto

final class SottoLayoutTests: XCTestCase {
    @MainActor
    func testFiveSkillClassHeaderFitsNarrowPhoneAndTabletReadingColumns() throws {
        let detail = try JSONDecoder().decode(SottoClassDetail.self, from: Data(#"{"id":"class","courseId":"course","status":"AVAILABLE","order":2,"passThreshold":0.7,"submitted":false,"lesson":{"title":"Numbers and dates","level":"A1","objective":"Count to 100 in German and state the day of the week and today's date."},"sections":[{"id":"g","skill":"GRAMMAR","status":"AVAILABLE","attempt":0,"questions":[],"prompts":[],"writingPrompts":[]},{"id":"r","skill":"READING","status":"AVAILABLE","attempt":0,"questions":[],"prompts":[],"writingPrompts":[]},{"id":"l","skill":"LISTENING","status":"AVAILABLE","attempt":0,"questions":[],"prompts":[],"writingPrompts":[]},{"id":"s","skill":"SPEAKING","status":"AVAILABLE","attempt":0,"questions":[],"prompts":[],"writingPrompts":[]},{"id":"w","skill":"WRITING","status":"AVAILABLE","attempt":0,"questions":[],"prompts":[],"writingPrompts":[]}]}"#.utf8))
        let viewports: [(CGFloat, SottoLayoutMode)] = [(343, .compact), (408, .compact), (540, .regular)]
        for (width, layout) in viewports {
            let view = ClassHeroHeader(classDetail: detail, answeredCount: 0, questionCount: 8, completionProgress: 0, completionPercent: 0)
                .environment(\.sottoLayout, layout)
            let controller = UIHostingController(rootView: view)
            let size = controller.sizeThatFits(in: CGSize(width: width, height: 10_000))
            XCTAssertLessThanOrEqual(size.width, width + 0.5, "Five skills must wrap inside the available reading column.")
            XCTAssertGreaterThan(size.height, 300)
        }
    }

    @MainActor
    func testCompactIntroStacksVisualsAndExamplesWithinPhoneWidth() {
        let intro = SottoClassIntro(purpose: "Build A1 control of numbers and dates.", about: "Count to 100 in German and state today's date.", focus: ["Recognize cardinal and ordinal numbers"], examples: [.init(target: "einundzwanzig", meaning: "twenty-one", note: "Say the units before the tens.")], tips: [], visuals: .init(timeline: .init(title: "Learning path", steps: ["Recognize cardinal numbers", "Recognize ordinal numbers"]), contrast: .init(title: "Compare examples", leftLabel: "eins", leftItems: ["One item"], rightLabel: "erste", rightItems: ["First item"]), callouts: [], links: []))
        let controller = UIHostingController(rootView: ClassIntroBlock(intro: intro, onSelectionHelp: { _, _ in }).environment(\.sottoLayout, .compact))
        let size = controller.sizeThatFits(in: CGSize(width: 343, height: 10_000))
        XCTAssertLessThanOrEqual(size.width, 343.5)
        XCTAssertGreaterThan(size.height, 300)
    }

    @MainActor
    func testAccessibilityTextStacksRegularWidthControls() throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let previousWindow = scene.windows.first { $0.isKeyWindow }
        for textSize in [DynamicTypeSize.large, .accessibility5] {
            let content = SottoAdaptiveStack(spacing: 12) {
                TextField("First action", text: .constant("First action"))
                TextField("Second action", text: .constant("Second action"))
            }
            .environment(\.sottoLayout, .regular)
            .environment(\.dynamicTypeSize, textSize)
            let controller = UIHostingController(rootView: content)
            let window = UIWindow(windowScene: scene)
            window.rootViewController = controller
            window.makeKeyAndVisible()
            defer {
                window.isHidden = true
                previousWindow?.makeKeyAndVisible()
            }
            controller.view.frame = CGRect(x: 0, y: 0, width: 600, height: 400)
            controller.view.layoutIfNeeded()
            func fields(in view: UIView) -> [UITextField] {
                view.subviews.flatMap { child in
                    (child as? UITextField).map { [$0] } ?? fields(in: child)
                }
            }
            let inputs = fields(in: controller.view)
            let first = try XCTUnwrap(inputs.first { $0.text == "First action" })
            let second = try XCTUnwrap(inputs.first { $0.text == "Second action" })
            let firstFrame = first.convert(first.bounds, to: controller.view)
            let secondFrame = second.convert(second.bounds, to: controller.view)
            if textSize.isAccessibilitySize {
                XCTAssertGreaterThanOrEqual(secondFrame.minY, firstFrame.maxY)
            } else {
                XCTAssertEqual(secondFrame.midY, firstFrame.midY, accuracy: 1)
            }
            XCTAssertLessThanOrEqual(secondFrame.maxX, 601)
        }
    }

    func testCompactSizeClassStacksAndDropsHandwriting() {
        let layout = SottoLayoutMode(.compact)

        XCTAssertEqual(layout, .compact)
        XCTAssertFalse(layout.supportsHandwriting)
        XCTAssertEqual(layout.gridColumns, 1)
    }

    func testRegularSizeClassKeepsPanelsAndHandwriting() {
        let layout = SottoLayoutMode(.regular)

        XCTAssertEqual(layout, .regular)
        XCTAssertTrue(layout.supportsHandwriting)
        XCTAssertEqual(layout.gridColumns, 2)
    }

    /// SwiftUI reports a nil size class before the first layout pass. Falling
    /// back to compact there would flash the phone layout on an iPad.
    func testUnknownSizeClassFallsBackToRegular() {
        XCTAssertEqual(SottoLayoutMode(nil), .regular)
    }

    func testCompactUsesTighterMarginsAndFullWidthReading() {
        let compact = SottoLayoutMode(.compact)
        let regular = SottoLayoutMode(.regular)

        XCTAssertLessThan(compact.pagePadding, regular.pagePadding)
        XCTAssertLessThan(compact.heroTitleSize, regular.heroTitleSize)
        XCTAssertEqual(compact.readableWidth, .infinity)
        XCTAssertLessThan(regular.readableWidth, .infinity)
    }
}
