import XCTest

@MainActor
final class PlayInvitationUITests: XCTestCase {
    func testSystemInvitationCreatesAnApprovedProfileAndPlaysAllThreeNativeGames() async throws {
        continueAfterFailure = false
        let fixture = try PlayUIFixture()
        let server = try LocalHTTPServer { fixture.respond($0) }
        try await server.start()
        defer { server.stop() }
        let app = XCUIApplication()
        app.terminate()
        var url = URLComponents(string: "sotto://play/join")!
        url.queryItems = [URLQueryItem(name: "v", value: "1"), URLQueryItem(name: "server", value: server.url.absoluteString),
            URLQueryItem(name: "code", value: "ABCDEFGHJK23")]
        app.open(try XCTUnwrap(url.url))
        let name = app.textFields["play.newName"]
        XCTAssertTrue(name.waitForExistence(timeout: 15), app.debugDescription)
        let cameraAlert = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.matching(
            NSPredicate(format: "label CONTAINS[c] %@ AND label CONTAINS[c] %@", "Sotto", "camera")
        ).firstMatch
        if cameraAlert.waitForExistence(timeout: 3) {
            let allow = cameraAlert.buttons["Allow"]
            XCTAssertTrue(allow.waitForExistence(timeout: 5))
            allow.tap()
            XCTAssertTrue(cameraAlert.waitForNonExistence(timeout: 5))
        }
        name.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        name.typeText("Native Sam")
        XCTAssertEqual(name.value as? String, "Native Sam")
        app.swipeUp()
        let consent = app.switches["Create my learner profile on this server"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.tap()
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
        try tap("Close", app: app)
        try tap("Unpair this device", app: app)
        XCTAssertTrue(app.staticTexts["Pair this device"].waitForExistence(timeout: 10))
    }

    private enum InteractionFailure: Error {
        case missingButton(String), invisibleButton(String), disabledButton(String)
    }

    private func tap(_ title: String, app: XCUIApplication, timeout: TimeInterval = 10) throws {
        let button = app.buttons[title].firstMatch
        guard button.waitForExistence(timeout: timeout) else { throw InteractionFailure.missingButton(title) }
        let deadline = ContinuousClock.now.advanced(by: .seconds(timeout))
        var scrolls = 0
        while ContinuousClock.now < deadline {
            let frame = button.frame
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
                if button.isEnabled {
                    origin.withOffset(CGVector(dx: frame.midX - bounds.minX, dy: frame.midY - bounds.minY)).tap()
                    return
                }
                Thread.sleep(forTimeInterval: 0.05)
                continue
            }
            guard scrolls < 6 else { throw InteractionFailure.invisibleButton(title) }
            let scroll = app.scrollViews.containing(.button, identifier: title).firstMatch
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
        throw InteractionFailure.disabledButton(title)
    }
}
