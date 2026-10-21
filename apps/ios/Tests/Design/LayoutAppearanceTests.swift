import SwiftUI
import UIKit
import XCTest

@testable import Sotto

@MainActor
final class LayoutAppearanceTests: XCTestCase {
    func testNativePartnerGamesWrapAt375PointsAndLargeTabletTextInBothAppearances() async throws {
        let fixtures = try PlayTestFixtures.load()
        let phone = Viewport(name: "play-phone-375", size: CGSize(width: 375, height: 812),
            layout: .compact, textSize: .large)
        let tablet = Viewport(name: "play-narrow-tablet", size: CGSize(width: 540, height: 700),
            layout: .regular, textSize: .accessibility3)
        for roundName in ["initial-0-HOST", "initial-2-HOST", "message-3-4-HOST"] {
            let room = try fixtures.room(round: roundName)
            let round = try XCTUnwrap(room.round)
            let model = SottoAppModel(credentials: PlayTestIdentity.connection(server: LayoutFixtures.server),
                credentialStore: PlayCredentialMemoryStore(), playStore: PlayMemoryStore())
            for viewport in [phone, tablet] {
                for style in [UIUserInterfaceStyle.light, .dark] {
                    let content = PlayRoundView(coordinator: model.play, room: room, round: round)
                        .environmentObject(model).padding(18).background(SottoTheme.paper)
                    let host = try mount(ScrollView { content }, viewport: viewport, style: style)
                    defer { host.close() }
                    await settle()
                    let scroll = try XCTUnwrap(descendants(of: host.content.view).compactMap { $0 as? UIScrollView }
                        .first { $0.isScrollEnabled && $0.bounds.width > host.content.view.bounds.width * 0.7 })
                    XCTAssertLessThanOrEqual(scroll.contentSize.width, scroll.bounds.width + 1,
                        "The native game must fit \(viewport.name) with \(style).")
                    attach(host.content.view, name: "play-\(roundName)-\(viewport.name)-\(style.rawValue)")
                }
            }
        }
    }

    func testClassTeachingFitsPhoneTabletAndNarrowReadingColumns() async throws {
        let detail = try LayoutFixtures.classDetail()
        let teaching = try XCTUnwrap(detail.teaching)
        let scope = XCTAttachment(string:
            "Actual hosted SwiftUI views use synthetic viewport widths and fixtures. " +
            "Landscape-width and split-width cases do not rotate the simulator or invoke system Split View."
        )
        scope.name = "layout-matrix-scope"
        scope.lifetime = .keepAlways
        add(scope)
        for viewport in viewports {
            for style in [UIUserInterfaceStyle.light, .dark] {
                let content = VStack(alignment: .leading, spacing: 20) {
                    ClassHeroHeader(
                        classDetail: detail, answeredCount: 0, questionCount: 1,
                        completionProgress: 0, completionPercent: 0
                    )
                    ClassTeachingView(teaching: teaching, onSelectionHelp: { _, _ in })
                }
                .padding(viewport.layout == .compact ? 16 : 28)
                .background(SottoTheme.paper)
                let measured = measuredSize(content, viewport: viewport)
                XCTAssertLessThanOrEqual(
                    measured.width, viewport.size.width + 1,
                    "Teaching must wrap inside \(viewport.name), \(style)."
                )
                let host = try mount(ScrollView { content }, viewport: viewport, style: style)
                defer { host.close() }
                await settle()
                attach(host.content.view, name: "teaching-\(viewport.name)-\(style.rawValue)")
                let purpose = try XCTUnwrap(descendants(of: host.content.view)
                    .compactMap { $0 as? UITextView }.first { $0.text == teaching.explanation })
                let scroll = try XCTUnwrap(scrollAncestor(of: purpose))
                let start = purpose.convert(purpose.bounds, to: scroll).minY
                scroll.setContentOffset(CGPoint(x: 0, y: start), animated: false)
                await settle()
                attach(host.content.view,
                       name: "teaching-detail-\(viewport.name)-\(style.rawValue)")
                if viewport.textSize.isAccessibilitySize {
                    let skills = try mount(
                        ScrollView {
                            ClassSkillMap(sections: detail.sections)
                                .padding(viewport.layout == .compact ? 32 : 54)
                        }, viewport: viewport, style: style
                    )
                    await settle()
                    attach(skills.content.view,
                           name: "skills-\(viewport.name)-\(style.rawValue)")
                    skills.close()
                }
            }
        }
    }

    func testLargeTextConsentRemainsVerticallyScrollableWithoutSideScrolling() async throws {
        for (viewport, style) in [viewports[0], viewports[3]].flatMap({ viewport in
            [UIUserInterfaceStyle.light, .dark].map { (viewport, $0) }
        }) {
            let content = PrivacyConsentView(
                serverURL: LayoutFixtures.server, onAccept: {}, onDecline: {}
            )
            let host = try mount(content, viewport: viewport, style: style)
            defer { host.close() }
            await settle()
            let scroll = try XCTUnwrap(verticalScrollView(in: host.content.view))
            XCTAssertGreaterThan(scroll.contentSize.height, scroll.bounds.height)
            scrollToEnd(scroll)
            await settle()
            XCTAssertGreaterThan(scroll.contentOffset.y, 0)
            XCTAssertLessThanOrEqual(
                scroll.contentSize.width, scroll.bounds.width + 1,
                "Consent must remain vertically readable without side scrolling."
            )
            attach(host.content.view, name: "consent-actions-\(viewport.name)-\(style.rawValue)")
        }
    }

    func testPairingCanRevealLastFieldWhenKeyboardLeavesShortTabletViewport() async throws {
        let viewport = Viewport(
            name: "tablet-keyboard", size: CGSize(width: 1024, height: 360),
            layout: .regular, textSize: .xxxLarge
        )
        let host = try mount(
            PairingView().environmentObject(LayoutFixtures.model()),
            viewport: viewport, style: .dark
        )
        defer { host.close() }
        await settle()
        let field = try XCTUnwrap(
            descendants(of: host.content.view).compactMap { $0 as? UITextField }
                .first { $0.placeholder == "Paste pairing link" }
        )
        let scroll = try XCTUnwrap(scrollAncestor(of: field))
        XCTAssertGreaterThan(scroll.contentSize.height, scroll.bounds.height)
        scroll.scrollRectToVisible(field.convert(field.bounds, to: scroll), animated: false)
        await settle()
        let visible = scroll.bounds.insetBy(dx: -1, dy: -1)
        XCTAssertTrue(visible.contains(field.convert(field.bounds, to: scroll)))
        attach(host.content.view, name: "pairing-short-tablet-last-field")
        let cameraMessage = try XCTUnwrap(descendants(of: host.content.view)
            .compactMap { $0 as? UILabel }.first {
                $0.text == "Camera unavailable. Paste the pairing link instead."
            })
        let scannerScroll = try XCTUnwrap(scrollAncestor(of: cameraMessage))
        XCTAssertFalse(scannerScroll === scroll,
                       "The scanner and manual form must scroll independently.")
        XCTAssertGreaterThan(scannerScroll.contentSize.height, scannerScroll.bounds.height)
        scrollToEnd(scannerScroll)
        await settle()
        attach(host.content.view, name: "pairing-short-tablet-scanner-instructions")
    }

    func testSettingsSheetKeepsProfileEditorInsideNarrowTablet() async throws {
        let narrowSheet = Viewport(
            name: "narrow-settings-sheet", size: CGSize(width: 540, height: 700),
            layout: .regular, textSize: .accessibility3
        )
        for (viewport, style) in [viewports[0], narrowSheet].flatMap({ viewport in
            [UIUserInterfaceStyle.light, .dark].map { (viewport, $0) }
        }) {
            let host = try mount(
                SettingsView().environmentObject(LayoutFixtures.model()),
                viewport: viewport, style: style
            )
            defer { host.close() }
            let editor = try await nameEditor(in: host.content.view)
            let scroll = try XCTUnwrap(scrollAncestor(of: editor))
            scroll.scrollRectToVisible(editor.convert(editor.bounds, to: scroll), animated: false)
            await settle()
            XCTAssertTrue(scroll.bounds.insetBy(dx: -1, dy: -1)
                .contains(editor.convert(editor.bounds, to: scroll)))
            XCTAssertLessThanOrEqual(scroll.contentSize.width, scroll.bounds.width + 1)
            attach(host.content.view, name: "settings-profile-\(viewport.name)-\(style.rawValue)")
            scrollToEnd(scroll)
            await settle()
            attach(host.content.view, name: "settings-details-\(viewport.name)-\(style.rawValue)")
        }
    }

    func testBothClassModesKeepWritingEditorInsideScrollableViewport() async throws {
        let detail = try LayoutFixtures.classDetail()
        for (viewport, style) in [viewports[0], viewports[3]].flatMap({ viewport in
            [UIUserInterfaceStyle.light, .dark].map { (viewport, $0) }
        }) {
            for workbook in [false, true] {
                let model = LayoutFixtures.model()
                model.pencilWorkbook = workbook
                let content = ClassSessionView(
                    classDetail: detail, progress: LearningProgressStore(),
                    drafts: WritingDraftStore(), initialSectionId: "layout-writing"
                ).environmentObject(model)
                let host = try mount(content, viewport: viewport, style: style)
                defer { host.close() }
                await settle()
                let scroll = try XCTUnwrap(verticalScrollView(in: host.content.view))
                scrollToEnd(scroll)
                await settle()
                let editor = try XCTUnwrap(descendants(of: host.content.view)
                    .compactMap { $0 as? UITextView }.first { $0.isEditable })
                scroll.scrollRectToVisible(editor.convert(editor.bounds, to: scroll), animated: false)
                await settle()
                let editorFrame = editor.convert(editor.bounds, to: scroll)
                XCTAssertLessThanOrEqual(editorFrame.width, scroll.bounds.width + 1)
                XCTAssertTrue(scroll.bounds.intersects(editorFrame))
                attach(host.content.view,
                       name: "class-writing-\(viewport.name)-workbook\(workbook)-\(style.rawValue)")
                scrollToEnd(scroll)
                await settle()
                attach(host.content.view,
                       name: "class-footer-\(viewport.name)-workbook\(workbook)-\(style.rawValue)")
            }
        }
    }

    func testClassOpensWithAcceptedTeachingAndKeepsTheGuidedAnswerHidden() async throws {
        let detail = try LayoutFixtures.classDetail()
        let teaching = try XCTUnwrap(detail.teaching)
        for viewport in viewports {
            for style in [UIUserInterfaceStyle.light, .dark] {
                let content = ClassSessionView(classDetail: detail, progress: LearningProgressStore(),
                    drafts: WritingDraftStore()).environmentObject(LayoutFixtures.model())
                let host = try mount(content, viewport: viewport, style: style)
                defer { host.close() }
                await settle()
                let text = descendants(of: host.content.view).compactMap { ($0 as? UITextView)?.text }
                XCTAssertTrue(text.contains(teaching.explanation))
                XCTAssertFalse(text.contains(teaching.guidedPractice.answer))
                XCTAssertFalse(text.contains(detail.sections[0].questions[0].question))
                let explanation = try XCTUnwrap(descendants(of: host.content.view)
                    .compactMap { $0 as? UITextView }.first { $0.text == teaching.explanation })
                let scroll = try XCTUnwrap(scrollAncestor(of: explanation))
                XCTAssertLessThanOrEqual(scroll.contentSize.width, scroll.bounds.width + 1)
                attach(host.content.view,
                    name: "class-lesson-before-practice-\(viewport.name)-\(style.rawValue)")
            }
        }
    }

    func testClassPracticeShowsOneQuestionAndOnlyExplainsAnAnsweredChoice() async throws {
        let detail = try LayoutFixtures.classDetail()
        let section = try XCTUnwrap(detail.sections.first)
        let question = try XCTUnwrap(section.questions.first)
        for answered in [false, true] {
            let content = ClassSectionView(classId: detail.id, section: section,
                answers: .constant(answered ? [question.id: 0] : [:]), drafts: WritingDraftStore(),
                pencilWorkbook: false, classAttempt: 1, pencilToolPicker: WorkbookTools.makeWorkbookToolPicker(),
                onPencilReviewRequired: { _, _ in }, onSelectionHelp: { _, _ in })
            let host = try mount(ScrollView { content }, viewport: viewports[0], style: .light)
            defer { host.close() }
            await settle()
            let text = descendants(of: host.content.view).compactMap { ($0 as? UITextView)?.text }
            XCTAssertTrue(text.contains(question.question))
            XCTAssertFalse(text.contains(section.questions[1].question))
            XCTAssertEqual(text.contains(try XCTUnwrap(question.explanation)), answered)
            attach(host.content.view, name: "class-question-answered-\(answered)")
        }
    }

    func testPresentedSettingsSheetSupportsFocusedProfileEditing() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first)
        let previousWindow = scene.windows.first { $0.isKeyWindow }
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = .dark
        let root = UIViewController()
        window.rootViewController = root
        window.makeKeyAndVisible()
        defer {
            window.endEditing(true)
            root.dismiss(animated: false)
            window.isHidden = true
            previousWindow?.makeKeyAndVisible()
        }
        let layout: SottoLayoutMode = UIDevice.current.userInterfaceIdiom == .pad
            ? .regular : .compact
        let content = SettingsView().environmentObject(LayoutFixtures.model())
            .environment(\.sottoLayout, layout)
            .environment(\.dynamicTypeSize, .accessibility3)
        let sheet = UIHostingController(rootView: content)
        sheet.traitOverrides.preferredContentSizeCategory = .accessibilityExtraLarge
        sheet.modalPresentationStyle = .formSheet
        root.present(sheet, animated: false)
        let editor = try await nameEditor(in: sheet.view)
        XCTAssertTrue(editor.becomeFirstResponder())
        for _ in 0..<40 {
            sheet.view.layoutIfNeeded()
            if sheet.view.keyboardLayoutGuide.layoutFrame.height > 80 { break }
            await settle()
        }
        let scroll = try XCTUnwrap(scrollAncestor(of: editor))
        scroll.scrollRectToVisible(editor.convert(editor.bounds, to: scroll), animated: false)
        await settle()
        let frame = editor.convert(editor.bounds, to: window)
        XCTAssertTrue(sheet.view.convert(sheet.view.bounds, to: window).intersects(frame))
        let keyboard = sheet.view.convert(sheet.view.keyboardLayoutGuide.layoutFrame, to: window)
        if keyboard.height > 80 {
            XCTAssertLessThanOrEqual(frame.maxY, keyboard.minY + 1)
        }
        editor.insertText(" layout")
        XCTAssertTrue(editor.text?.contains("layout") == true)
        let keyboardProof = XCTAttachment(string:
            "Synthetic Settings sheet on \(UIDevice.current.model). " +
            "Keyboard frame: \(keyboard). Editor frame: \(frame). " +
            "An onscreen keyboard is verified only when its height exceeds80pt."
        )
        keyboardProof.name = "settings-sheet-keyboard-geometry"
        keyboardProof.lifetime = .keepAlways
        add(keyboardProof)
        attach(window, name: "presented-settings-sheet-focused-editor")
    }

    func testLongMaterialNamesAndWritingGuidanceFitNarrowPhoneColumn() async throws {
        let detail = try LayoutFixtures.classDetail()
        let prompt = try XCTUnwrap(detail.sections.last?.writingPrompts.first)
        let drafts = WritingDraftStore()
        let material = SottoCourseMaterial(
            id: "synthetic-material",
            name: "German vocabulary and exercise guidance (reviewed transcription).txt",
            mimeType: "text/plain", byteSize: 512,
            textRetained: false, legacyTextUrl: nil
        )
        let content = VStack(alignment: .leading, spacing: 24) {
            CourseMaterialList(materials: [material])
            WritingPracticeView(
                drafts: drafts, prompts: [prompt], offersHandwriting: false,
                onSelectionHelp: { _, _ in }
            )
        }
        .padding(18)
        .environmentObject(LayoutFixtures.model())
        let viewport = viewports[0]
        for style in [UIUserInterfaceStyle.light, .dark] {
            let measured = measuredSize(content, viewport: viewport)
            let host = try mount(ScrollView { content }, viewport: viewport, style: style)
            defer { host.close() }
            await settle()
            XCTAssertLessThanOrEqual(measured.width, viewport.size.width + 1)
            let editor = try XCTUnwrap(descendants(of: host.content.view)
                .compactMap { $0 as? UITextView }.first { $0.isEditable })
            XCTAssertLessThanOrEqual(editor.bounds.width, viewport.size.width - 36)
            XCTAssertGreaterThan(editor.bounds.height, 100)
            attach(host.content.view, name: "phone375-materials-and-writing-guidance-\(style.rawValue)")
        }
    }

    func testLargeTextPracticeResumeAndLiveDirectionFitPhoneWidth() async throws {
        let viewport = viewports[0]
        let overview = try LayoutFixtures.practiceOverview()
        let start = try LayoutFixtures.readyPractice()
        let course = try LayoutFixtures.course()
        let panel = PracticeDuePanel(overview: overview, onResume: { _ in }, onDelete: { _ in })
            .padding(18).environmentObject(LayoutFixtures.model())
        let measured = measuredSize(panel, viewport: viewport)
        XCTAssertLessThanOrEqual(measured.width, viewport.size.width + 1)
        for style in [UIUserInterfaceStyle.light, .dark] {
            let practice = try mount(ScrollView { panel }, viewport: viewport, style: style)
            await settle()
            attach(practice.content.view, name: "practice-resume-phone375-\(style.rawValue)")
            practice.close()
            let ready = try mount(
                PracticeStartView(
                    start: start, progress: LearningProgressStore(),
                    drafts: WritingDraftStore()
                ).environmentObject(LayoutFixtures.model()),
                viewport: viewport, style: style
            )
            await settle()
            if let scroll = verticalScrollView(in: ready.content.view) {
                scrollToEnd(scroll)
                await settle()
            }
            attach(ready.content.view, name: "practice-submit-phone375-\(style.rawValue)")
            ready.close()
            let live = try mount(
                LiveConversationView(course: course).environmentObject(LayoutFixtures.model()),
                viewport: viewport, style: style
            )
            defer { live.close() }
            await settle()
            let picker = try XCTUnwrap(descendants(of: live.content.view)
                .compactMap { $0 as? UISegmentedControl }.first)
            let frame = picker.convert(picker.bounds, to: live.content.view)
            XCTAssertGreaterThan(frame.width, 100)
            XCTAssertLessThanOrEqual(frame.maxX, viewport.size.width)
            attach(live.content.view, name: "live-direction-phone375-\(style.rawValue)")
        }
    }

    func testPreparationAndUnsuccessfulAttemptsFitPhoneAndTablet() async throws {
        for viewport in [viewports[0], viewports[2]] {
            for state in ["RUNNING", "FAILED", "CANCELLED", "UNRESOLVED"] {
                let start = try JSONDecoder().decode(SottoPracticeStart.self, from: Data("""
                    {"status":"preparing","sessionId":"synthetic-attempt","kind":"VOCAB",
                    "preparationStatus":"\(state)","canRecover":\(state == "UNRESOLVED")}
                    """.utf8))
                let model = LayoutFixtures.model()
                if !start.isPreparing { model.practiceStart = start }
                let host = try mount(
                    PracticeStartView(start: start, progress: LearningProgressStore(), drafts: WritingDraftStore())
                        .environmentObject(model), viewport: viewport, style: .light
                )
                await settle()
                if !start.isPreparing {
                    XCTAssertEqual(model.practiceStart, start,
                        "Terminal attempts must not poll and replace their outcome.")
                }
                let scroll = try XCTUnwrap(descendants(of: host.content.view)
                    .compactMap { $0 as? UIScrollView }.first)
                XCTAssertLessThanOrEqual(scroll.contentSize.width, scroll.bounds.width + 1)
                attach(host.content.view, name: "practice-\(state.lowercased())-\(viewport.name)")
                host.close()
            }

            let overview = try JSONDecoder().decode(SottoPracticeOverview.self, from: Data(
                #"{"due":{"vocab":0,"grammar":0},"totalVocab":12,"recent":[{"id":"failed","kind":"VOCAB","status":"FAILED"},{"id":"cancelled","kind":"VOCAB","status":"CANCELLED"}]}"#.utf8))
            let panel = PracticeDuePanel(overview: overview, onResume: { _ in }, onDelete: { _ in })
                .padding(18).environmentObject(LayoutFixtures.model())
            let size = measuredSize(panel, viewport: viewport)
            XCTAssertGreaterThan(size.height, 100,
                "Failed and cancelled attempts remain visible when nothing is due.")
            XCTAssertLessThanOrEqual(size.width, viewport.size.width + 1)
            let host = try mount(ScrollView { panel }, viewport: viewport, style: .light)
            await settle()
            attach(host.content.view, name: "practice-unsuccessful-\(viewport.name)")
            host.close()
        }
    }

    private struct Viewport {
        let name: String
        let size: CGSize
        let layout: SottoLayoutMode
        let textSize: DynamicTypeSize

        var contentSizeCategory: UIContentSizeCategory {
            switch textSize {
            case .accessibility3: return .accessibilityExtraLarge
            case .accessibility5: return .accessibilityExtraExtraExtraLarge
            case .xxxLarge: return .extraExtraExtraLarge
            default: return .large
            }
        }
    }

    private var viewports: [Viewport] {
        [
            Viewport(name: "phone375-accessibility", size: CGSize(width: 375, height: 812),
                     layout: .compact, textSize: .accessibility3),
            Viewport(name: "phone17", size: CGSize(width: 402, height: 874),
                     layout: .compact, textSize: .large),
            Viewport(name: "ipad-portrait", size: CGSize(width: 1024, height: 1366),
                     layout: .regular, textSize: .large),
            Viewport(name: "ipad-split-accessibility", size: CGSize(width: 600, height: 820),
                     layout: .regular, textSize: .accessibility3),
            Viewport(name: "ipad-landscape", size: CGSize(width: 1366, height: 1024),
                     layout: .regular, textSize: .large),
            Viewport(name: "ipad-narrow-compact", size: CGSize(width: 375, height: 820),
                     layout: .compact, textSize: .large),
            Viewport(name: "ipad-narrow-regular", size: CGSize(width: 540, height: 820),
                     layout: .regular, textSize: .accessibility3),
            Viewport(name: "phone375-largest-text", size: CGSize(width: 375, height: 812),
                     layout: .compact, textSize: .accessibility5),
            Viewport(name: "ipad540-largest-text", size: CGSize(width: 540, height: 820),
                     layout: .regular, textSize: .accessibility5),
        ]
    }

    private func mount<Content: View>(
        _ content: Content, viewport: Viewport, style: UIUserInterfaceStyle
    ) throws -> MountedViewport {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }.first)
        let view = content.environment(\.sottoLayout, viewport.layout)
            .environment(\.dynamicTypeSize, viewport.textSize)
        let controller = UIHostingController(rootView: AnyView(view))
        controller.traitOverrides.preferredContentSizeCategory = viewport.contentSizeCategory
        let container = ViewportController(content: controller, size: viewport.size)
        let window = UIWindow(windowScene: scene)
        let previousWindow = scene.windows.first { $0.isKeyWindow }
        window.overrideUserInterfaceStyle = style
        window.rootViewController = container
        window.makeKeyAndVisible()
        container.loadViewIfNeeded()
        container.view.layoutIfNeeded()
        return MountedViewport(window: window, content: controller,
                               previousWindow: previousWindow)
    }

    private func measuredSize<Content: View>(_ content: Content, viewport: Viewport) -> CGSize {
        let view = content.environment(\.sottoLayout, viewport.layout)
            .environment(\.dynamicTypeSize, viewport.textSize)
        let controller = UIHostingController(rootView: view)
        controller.traitOverrides.preferredContentSizeCategory = viewport.contentSizeCategory
        return controller.sizeThatFits(
            in: CGSize(width: viewport.size.width, height: 20_000)
        )
    }

    private func nameEditor(in view: UIView) async throws -> UITextField {
        for _ in 0..<100 {
            if let field = descendants(of: view).compactMap({ $0 as? UITextField })
                .first(where: { $0.text == "Synthetic learner" }) { return field }
            await settle()
        }
        XCTFail("The synthetic Settings response must reach the real profile editor.")
        throw SottoAPIError.message("The Settings fixture did not load.")
    }

    private func settle() async {
        try? await Task.sleep(for: .milliseconds(60))
    }

    private func descendants(of view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap { descendants(of: $0) }
    }

    private func verticalScrollView(in view: UIView) -> UIScrollView? {
        descendants(of: view).compactMap { $0 as? UIScrollView }.first {
            $0.isScrollEnabled && $0.bounds.width > view.bounds.width * 0.7
                && $0.contentSize.height > $0.bounds.height
        }
    }

    private func scrollAncestor(of view: UIView) -> UIScrollView? {
        var ancestor = view.superview
        while let candidate = ancestor {
            if let scroll = candidate as? UIScrollView, scroll.isScrollEnabled { return scroll }
            ancestor = candidate.superview
        }
        return nil
    }

    private func scrollToEnd(_ scroll: UIScrollView) {
        scroll.setContentOffset(CGPoint(
            x: 0, y: max(0, scroll.contentSize.height - scroll.bounds.height
                         + scroll.adjustedContentInset.bottom)
        ), animated: false)
    }

    private func attach(_ view: UIView, name: String) {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(bounds: view.bounds, format: format).image { _ in
            view.drawHierarchy(in: view.bounds, afterScreenUpdates: true)
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "synthetic-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private struct MountedViewport {
        let window: UIWindow
        let content: UIHostingController<AnyView>
        let previousWindow: UIWindow?

        func close() {
            window.endEditing(true)
            window.isHidden = true
            window.rootViewController = nil
            previousWindow?.makeKeyAndVisible()
        }
    }

    private final class ViewportController: UIViewController {
        let content: UIViewController
        let size: CGSize

        init(content: UIViewController, size: CGSize) {
            self.content = content
            self.size = size
            super.init(nibName: nil, bundle: nil)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("Use init(content:size:)") }

        override func viewDidLoad() {
            super.viewDidLoad()
            addChild(content)
            view.addSubview(content.view)
            content.didMove(toParent: self)
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            content.view.frame = CGRect(origin: .zero, size: size)
            content.view.layoutIfNeeded()
        }
    }
}
