import XCTest

@MainActor
final class PlayInvitationUITests: XCTestCase {
    func testSystemInvitationCreatesAnApprovedProfileAndPlaysAllThreeNativeGames() async throws {
        continueAfterFailure = false
        let fixture = try PlayUIFixture()
        defer {
            let diagnostics = XCTAttachment(string: fixture.diagnostics)
            diagnostics.name = "game-fixture-actions"
            diagnostics.lifetime = .keepAlways
            add(diagnostics)
        }
        let server = try LocalHTTPServer { fixture.respond($0) }
        try await server.start()
        defer { server.stop() }
        let app = XCUIApplication()
        app.terminate()
        var url = URLComponents(string: "sotto://play/join")!
        url.queryItems = [URLQueryItem(name: "v", value: "1"), URLQueryItem(name: "server", value: server.url.absoluteString),
            URLQueryItem(name: "code", value: "ABCDEFGHJK23")]
        app.open(try XCTUnwrap(url.url))
        let cameraAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.matching(
            NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@", "Sotto", "camera")
        ).firstMatch
        if cameraAlert.waitForExistence(timeout: 3) {
            let allow = cameraAlert.buttons["Allow"]
            XCTAssertTrue(allow.waitForExistence(timeout: 5))
            allow.tap()
            XCTAssertTrue(cameraAlert.waitForNonExistence(timeout: 5))
        }
        let name = app.textFields["play.newName"]
        XCTAssertTrue(name.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(name.isEnabled, "The proposed name stays local until conduct is accepted.")
        try tap("play.conductConsent", type: .switch, app: app)
        let conductAccepted = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "1"),
            object: app.switches["play.conductConsent"]
        )
        await fulfillment(of: [conductAccepted], timeout: 10)
        XCTAssertTrue(name.wait(for: \.isEnabled, toEqual: true, timeout: 10), app.debugDescription)
        try tap("play.newName", type: .textField, app: app)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        name.typeText("Native Sam")
        XCTAssertEqual(name.value as? String, "Native Sam")
        app.swipeUp()
        let consent = app.switches["Create my learner profile on this server"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        try tap("Create my learner profile on this server", type: .switch, app: app)
        let profileCreationAccepted = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "1"), object: consent
        )
        await fulfillment(of: [profileCreationAccepted], timeout: 10)
        XCTAssertEqual(consent.value as? String, "1", app.debugDescription)
        try tap("Ask to join as a new learner", app: app)
        try tap("Finish joining", app: app, timeout: 15)
        let firstCard = app.buttons["play.choice.A"]
        XCTAssertTrue(firstCard.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.otherElements["play.room.fixture-room"].exists)
        XCTAssertFalse(app.staticTexts["Go for a walk"].exists)
        try tap("Show meanings", app: app)
        XCTAssertTrue(app.staticTexts["Go for a walk"].waitForExistence(timeout: 5))
        try tap("Hide meanings", app: app)
        XCTAssertFalse(app.staticTexts["Go for a walk"].exists)
        firstCard.tap()
        try tap("Next round", app: app)
        let guess = app.textFields["play.draft.GUESS"]
        XCTAssertTrue(guess.waitForExistence(timeout: 10), app.debugDescription)
        guess.tap(); guess.typeText("Giraffe")
        try tap("Guess", app: app)
        try tap("Understood", app: app)
        try tap("Next round", app: app)
        let line = app.textFields["play.draft.MESSAGE"]
        XCTAssertTrue(line.waitForExistence(timeout: 10), app.debugDescription)
        line.tap(); line.typeText("Wir kochen zusammen.")
        try tap("Send line", app: app)
        XCTAssertTrue(app.staticTexts["Plot twist"].waitForExistence(timeout: 10))
        let nextLine = app.textFields["play.draft.MESSAGE"]
        nextLine.tap(); nextLine.typeText("Dann nehmen wir mehr Essen mit.")
        try tap("Send line", app: app)
        try tap("Yes, mission done", app: app)
        try tap("Understood", app: app)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "native-three-game-recap"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertTrue(fixture.acknowledged)
        let requests = server.requests
        let intake = try XCTUnwrap(requests.first { $0.hasPrefix("POST /api/v1/play/invitations ") })
        XCTAssertFalse(intake.lowercased().contains("authorization:"))
        XCTAssertFalse(intake.lowercased().contains("cookie:"))
        XCTAssertTrue(intake.lowercased().contains("x-sotto-play-proof:"))
        XCTAssertFalse(requests.contains { $0.hasPrefix("POST /api/v1/users ") })
        XCTAssertTrue(intake.contains("\"acceptedConductVersion\":1"))
        try tap("Report or block partner", app: app)
        try tap("Block Alex", app: app)
        try tap("Block partner", app: app)
        XCTAssertTrue(app.staticTexts["Your blocked players"].waitForExistence(timeout: 10), app.debugDescription)
        try tap("Report content from your last game", app: app)
        try tap("Send report to server owner", app: app)
        try tap("Blocks and report responses", app: app)
        XCTAssertTrue(app.staticTexts["Server owner's response"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["I have closed the game and restricted this profile from partner games."].exists)
        try tap("Close", app: app)
        try tap("Unpair this device", app: app)
        XCTAssertTrue(app.staticTexts["Pair this device"].waitForExistence(timeout: 10))
    }

    private enum InteractionFailure: Error {
        case missingButton(String), invisibleButton(String), disabledButton(String)
    }

    private func tap(_ title: String, type: XCUIElement.ElementType = .button,
                     app: XCUIApplication, timeout: TimeInterval = 10) throws {
        let named = app.descendants(matching: type)[title].firstMatch
        let control = type == .switch ? named.switches.firstMatch : named
        guard control.waitForExistence(timeout: timeout) else {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "missing-control-\(title)"
            hierarchy.lifetime = .keepAlways
            add(hierarchy)
            throw InteractionFailure.missingButton(title)
        }
        var scrolls = 0
        var geometryChecks = 0
        while geometryChecks < 8 {
            geometryChecks += 1
            let frame = control.frame
            guard !frame.isEmpty,
                  [frame.minX, frame.minY, frame.maxX, frame.maxY].allSatisfy({ $0.isFinite }) else {
                throw InteractionFailure.invisibleButton(title)
            }
            let bounds = app.frame
            var top = bounds.minY + 8
            var bottom = bounds.maxY - 8
            let navigation = app.navigationBars.firstMatch
            if navigation.exists, !navigation.frame.contains(frame) { top = max(top, navigation.frame.maxY + 4) }
            let keyboard = app.keyboards.firstMatch
            if keyboard.exists { bottom = min(bottom, keyboard.frame.minY - 8) }
            let viewport = CGRect(x: bounds.minX + 8, y: top, width: bounds.width - 16, height: bottom - top)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            if viewport.contains(frame) {
                if control.isEnabled {
                    if type == .switch || type == .textField {
                        guard control.wait(for: \.isHittable, toEqual: true, timeout: timeout) else {
                            throw InteractionFailure.invisibleButton(title)
                        }
                        control.tap()
                    } else {
                        control.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    }
                    return
                }
                let deadline = ContinuousClock.now.advanced(by: .seconds(timeout))
                while !control.isEnabled {
                    guard ContinuousClock.now < deadline else { throw InteractionFailure.disabledButton(title) }
                    Thread.sleep(forTimeInterval: 0.05)
                }
                continue
            }
            guard scrolls < 6 else { throw InteractionFailure.invisibleButton(title) }
            let scroll = app.scrollViews.containing(type, identifier: title).firstMatch
            guard scroll.exists else { throw InteractionFailure.invisibleButton(title) }
            let visible = scroll.frame.intersection(viewport)
            guard !visible.isNull, visible.width > 0, visible.height > 44 else {
                throw InteractionFailure.invisibleButton(title)
            }
            let upwards = frame.maxY > viewport.maxY
            let start = origin.withOffset(CGVector(dx: visible.midX - bounds.minX,
                dy: visible.minY + visible.height * (upwards ? 0.75 : 0.25) - bounds.minY))
            let end = origin.withOffset(CGVector(dx: visible.midX - bounds.minX,
                dy: visible.minY + visible.height * (upwards ? 0.25 : 0.75) - bounds.minY))
            start.press(forDuration: 0.05, thenDragTo: end)
            scrolls += 1
        }
        throw InteractionFailure.invisibleButton(title)
    }
}
