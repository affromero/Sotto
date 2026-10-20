import XCTest

@MainActor
final class PlayInvitationUITests: XCTestCase {
    func testSystemInvitationCreatesAnApprovedProfileAndPlaysAllThreeNativeGames() async throws {
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
        name.tap()
        name.typeText("Native Sam")
        app.swipeUp()
        let consent = app.switches["Create my learner profile on this server"]
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        consent.tap()
        tap("Ask to join as a new learner", app: app)
        tap("Finish joining", app: app, timeout: 15)
        let firstCard = app.buttons["play.choice.A"]
        XCTAssertTrue(firstCard.waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Go for a walk"].exists)
        tap("Show meanings", app: app)
        XCTAssertTrue(app.staticTexts["Go for a walk"].waitForExistence(timeout: 5))
        tap("Hide meanings", app: app)
        XCTAssertFalse(app.staticTexts["Go for a walk"].exists)
        firstCard.tap()
        tap("Next round", app: app)
        let guess = app.textFields["play.draft.GUESS"]
        XCTAssertTrue(guess.waitForExistence(timeout: 10), app.debugDescription)
        guess.tap(); guess.typeText("Giraffe")
        tap("Guess", app: app)
        tap("Understood", app: app)
        tap("Next round", app: app)
        let line = app.textFields["play.draft.MESSAGE"]
        XCTAssertTrue(line.waitForExistence(timeout: 10), app.debugDescription)
        line.tap(); line.typeText("Wir kochen zusammen.")
        tap("Send line", app: app)
        XCTAssertTrue(app.staticTexts["Plot twist"].waitForExistence(timeout: 10))
        let nextLine = app.textFields["play.draft.MESSAGE"]
        nextLine.tap(); nextLine.typeText("Dann nehmen wir mehr Essen mit.")
        tap("Send line", app: app)
        tap("Yes, mission done", app: app)
        tap("Understood", app: app)
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
        tap("Close", app: app)
        tap("Unpair this device", app: app)
        XCTAssertTrue(app.staticTexts["Pair this device"].waitForExistence(timeout: 10))
    }

    private func tap(_ title: String, app: XCUIApplication, timeout: TimeInterval = 10) {
        let button = app.buttons[title].firstMatch
        for _ in 0..<6 {
            if button.exists && button.isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(button.waitForExistence(timeout: timeout), "Missing \(title): \(app.debugDescription)")
        button.tap()
    }
}
