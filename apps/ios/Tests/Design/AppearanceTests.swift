import PencilKit
import SwiftUI
import UIKit
import XCTest

@testable import Sotto

@MainActor
final class AppearanceTests: XCTestCase {
    func testReadingAndActionColorsRemainLegibleInBothAppearances() throws {
        for style: UIUserInterfaceStyle in [.light, .dark] {
            for contrast: UIAccessibilityContrast in [.normal, .high] {
                let traits = UITraitCollection {
                    $0.userInterfaceStyle = style
                    $0.accessibilityContrast = contrast
                }
                let surfaces = [SottoTheme.paper, SottoTheme.surface,
                                SottoTheme.introductionTint, SottoTheme.readingTint]
                for surface in surfaces {
                    for foreground in [SottoTheme.ink, SottoTheme.muted] {
                        XCTAssertGreaterThanOrEqual(try ratio(foreground, surface, traits), 4.5)
                    }
                }
                for foreground in [SottoTheme.primary, SottoTheme.success,
                                   SottoTheme.teal, SottoTheme.rose, SottoTheme.amber] {
                    for surface in [SottoTheme.paper, SottoTheme.surface] {
                        XCTAssertGreaterThanOrEqual(try ratio(foreground, surface, traits), 4.5)
                    }
                }
                XCTAssertGreaterThanOrEqual(try ratio(SottoTheme.onPrimary, SottoTheme.primary, traits), 4.5)
                XCTAssertGreaterThanOrEqual(try ratio(SottoTheme.onPrimary, SottoTheme.teal, traits), 4.5)
                for surface in [SottoTheme.paper, SottoTheme.surface] {
                    let pressed = try blend(SottoTheme.primary, opacity: 0.82, over: surface, traits: traits)
                    XCTAssertGreaterThanOrEqual(try ratio(SottoTheme.onPrimary, Color(uiColor: pressed), traits), 4.5)
                }
                for tint in [SottoTheme.primary, SottoTheme.teal, SottoTheme.rose, SottoTheme.amber] {
                    let background = try blend(tint, opacity: 0.08, over: SottoTheme.surface, traits: traits)
                    XCTAssertGreaterThanOrEqual(try ratio(SottoTheme.muted, Color(uiColor: background), traits), 4.5)
                }
            }
        }
    }

    func testMountedSelectableTextChangesAppearanceWithoutLosingSelection() async throws {
        let controller = UIHostingController(rootView:
            SelectableLearnerText("Gestern bin ich zu Fuß gegangen.", font: LearnerTextFonts.body,
                color: UIColor(SottoTheme.ink), onExamples: { _, _ in })
                .padding(20).background(SottoTheme.surface)
        )
        let window = try mount(controller)
        defer { window.isHidden = true }
        var textView: UITextView?
        for style: UIUserInterfaceStyle in [.light, .dark, .light] {
            window.overrideUserInterfaceStyle = style
            await settle(controller)
            let current = try XCTUnwrap(descendants(controller.view).compactMap { $0 as? UITextView }.first)
            if let textView {
                XCTAssertTrue(current === textView, "Appearance changes must preserve the mounted selectable view.")
                XCTAssertEqual(current.selectedRange, NSRange(location: 0, length: 7))
            }
            textView = current
            current.selectedRange = NSRange(location: 0, length: 7)
            XCTAssertEqual(current.traitCollection.userInterfaceStyle, style)
            let foreground = try XCTUnwrap(current.textColor)
            XCTAssertGreaterThanOrEqual(try ratio(Color(uiColor: foreground), SottoTheme.surface, current.traitCollection), 4.5)
            XCTAssertTrue(current.isSelectable)
            XCTAssertFalse(current.isEditable)
        }
    }

    func testCameraInstructionsRemainLegibleOverBrightCameraFrames() throws {
        for style: UIUserInterfaceStyle in [.light, .dark] {
            let traits = UITraitCollection(userInterfaceStyle: style)
            let background = Color(uiColor: try composite(SottoTheme.cameraOverlay, over: .white, traits: traits))
            let caption = Color(uiColor: try composite(SottoTheme.cameraCaption, over: background, traits: traits))
            XCTAssertGreaterThanOrEqual(try ratio(SottoTheme.onCameraOverlay, background, traits), 4.5)
            XCTAssertGreaterThanOrEqual(try ratio(caption, background, traits), 4.5)
        }
    }

    func testPaperStaysLightAndKeepsInkWhenItsWindowChangesAppearance() async throws {
        let canvas = PKCanvasView()
        let stroke = PKStroke(ink: PKInk(.pen, color: .black), path: PKStrokePath(
            controlPoints: [CGPoint(x: 30, y: 50), CGPoint(x: 150, y: 80)].enumerated().map { index, point in
                PKStrokePoint(location: point, timeOffset: Double(index), size: CGSize(width: 4, height: 4),
                    opacity: 1, force: 1, azimuth: 0, altitude: .pi / 2)
            }, creationDate: Date()))
        let original = PKDrawing(strokes: [stroke])
        canvas.drawing = original
        let paper = InkPaperView(canvas: canvas, pageSize: CGSize(width: 800, height: 600))
        let controller = UIViewController()
        controller.view.addSubview(paper)
        paper.frame = CGRect(x: 0, y: 0, width: 350, height: 300)
        let window = try mount(controller)
        defer { window.isHidden = true }
        let digest = LearningInkStore.drawingDigest(original)
        for style: UIUserInterfaceStyle in [.light, .dark, .light] {
            window.overrideUserInterfaceStyle = style
            await settle(controller)
            XCTAssertEqual(controller.traitCollection.userInterfaceStyle, style)
            XCTAssertEqual(paper.traitCollection.userInterfaceStyle, .light)
            XCTAssertEqual(canvas.traitCollection.userInterfaceStyle, .light)
            XCTAssertEqual(LearningInkStore.drawingDigest(canvas.drawing), digest)
            XCTAssertEqual(canvas.drawing.bounds, original.bounds)
        }
        let workbookPicker = WorkbookTools.makeWorkbookToolPicker()
        let handwritingPicker = HandwritingCanvas(canvas: PKCanvasView(), drawing: .constant(PKDrawing())).makeCoordinator().picker
        for picker in [workbookPicker, handwritingPicker] {
            XCTAssertEqual(picker.colorUserInterfaceStyle, .light,
                "Picker ink must match the physical paper while surrounding controls can stay dark.")
        }
        let fountain = try XCTUnwrap(workbookPicker.toolItems.compactMap { $0 as? PKToolPickerInkingItem }
            .first { $0.inkingTool.inkType == .fountainPen })
        XCTAssertGreaterThanOrEqual(try ratio(Color(uiColor: fountain.inkingTool.color), .white,
            UITraitCollection(userInterfaceStyle: .dark)), 4.5)
    }

    func testMountedLessonTextGrowsWithAccessibilityTextSize() async throws {
        let text = "Read the complete sentence before choosing. Compare the action with the example and explain your choice."
        let controller = UIHostingController(rootView:
            SelectableLearnerText(text, font: LearnerTextFonts.body,
                color: UIColor(SottoTheme.ink), onExamples: { _, _ in })
                .padding(20).background(SottoTheme.surface)
        )
        controller.traitOverrides.preferredContentSizeCategory = .large
        let window = try mount(controller)
        defer { window.isHidden = true }
        await settle(controller)
        let textView = try XCTUnwrap(descendants(controller.view).compactMap { $0 as? UITextView }.first)
        let normalHeight = textView.sizeThatFits(CGSize(width: 300, height: 10_000)).height
        controller.traitOverrides.preferredContentSizeCategory = .accessibilityExtraExtraExtraLarge
        await settle(controller)
        let largeHeight = textView.sizeThatFits(CGSize(width: 300, height: 10_000)).height
        XCTAssertEqual(textView.text, text)
        XCTAssertGreaterThan(largeHeight, normalHeight * 1.3,
            "Lesson text must grow when the mounted window changes its preferred text size.")
    }

    func testNewLessonTextUsesItsWindowsCurrentAccessibilitySize() async throws {
        let text = "Read the complete sentence before choosing. Compare the action with the example and explain your choice."
        var heights: [CGFloat] = []
        for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
            let controller = UIHostingController(rootView:
                SelectableLearnerText(text, font: LearnerTextFonts.body,
                    color: UIColor(SottoTheme.ink), onExamples: { _, _ in })
                    .padding(20).background(SottoTheme.surface)
            )
            controller.traitOverrides.preferredContentSizeCategory = category
            let window = try mount(controller)
            defer { window.isHidden = true }
            await settle(controller)
            let view = try XCTUnwrap(descendants(controller.view).compactMap { $0 as? UITextView }.first)
            heights.append(view.sizeThatFits(CGSize(width: 300, height: 10_000)).height)
        }
        XCTAssertGreaterThan(heights[1], heights[0] * 1.3,
            "A newly opened lesson must use the window's current text size.")
    }

    private func mount(_ controller: UIViewController) throws -> UIWindow {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 375, height: 812)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.layoutIfNeeded()
        return window
    }

    private func settle(_ controller: UIViewController) async {
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        try? await Task.sleep(for: .milliseconds(80))
    }

    private func descendants(_ view: UIView) -> [UIView] {
        view.subviews.flatMap { [$0] + descendants($0) }
    }

    private func components(_ color: Color, _ traits: UITraitCollection) throws -> [CGFloat] {
        let resolved = UIColor(color).resolvedColor(with: traits)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        XCTAssertTrue(resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha))
        return [red, green, blue, alpha]
    }

    private func luminance(_ values: [CGFloat]) -> CGFloat {
        zip(values, [0.2126, 0.7152, 0.0722]).reduce(0) { sum, pair in
            let component = pair.0 <= 0.04045 ? pair.0 / 12.92 : pow((pair.0 + 0.055) / 1.055, 2.4)
            return sum + component * pair.1
        }
    }

    private func ratio(_ foreground: Color, _ background: Color, _ traits: UITraitCollection) throws -> CGFloat {
        let first = luminance(try components(foreground, traits))
        let second = luminance(try components(background, traits))
        return (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    private func blend(_ foreground: Color, opacity: CGFloat, over background: Color, traits: UITraitCollection) throws -> UIColor {
        let values = zip(try components(foreground, traits), try components(background, traits))
            .map { $0 * opacity + $1 * (1 - opacity) }
        return UIColor(red: values[0], green: values[1], blue: values[2], alpha: 1)
    }

    private func composite(_ foreground: Color, over background: Color, traits: UITraitCollection) throws -> UIColor {
        let values = try components(foreground, traits)
        return try blend(foreground, opacity: values[3], over: background, traits: traits)
    }
}
