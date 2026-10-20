import XCTest

@MainActor
final class PlayMixedServerUITests: XCTestCase {
    private struct Configuration: Decodable {
        let server: URL
        let role: String
        let name: String
        let invitation: URL?
        let roomId: String?
    }
    private var control: URL {
        get throws {
            let raw = try XCTUnwrap(ProcessInfo.processInfo.environment["SOTTO_PLAY_TEST_CONTROL"])
            let url = try XCTUnwrap(URL(string: raw))
            XCTAssertEqual(url.scheme, "http")
            XCTAssertEqual(url.host, "127.0.0.1")
            return url
        }
    }

    func testNativeInvitationAndSixRoundsAgainstARealPartnerClient() async throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.terminate(); app.launch()
        if app.buttons["Close"].waitForExistence(timeout: 3) { app.buttons["Close"].tap() }
        if app.buttons["Unpair this device"].exists { try tap("Unpair this device", app) }
        var configuration = try await configuration()
        XCTAssertEqual(configuration.role, "GUEST")
        let deadline = ContinuousClock.now.advanced(by: .seconds(120))
        while configuration.invitation == nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(100))
            configuration = try await self.configuration()
        }
        let invitation = try XCTUnwrap(configuration.invitation)
        app.open(invitation)
        try fill(app.textFields["play.newName"], configuration.name, app)
        let consent = app.switches["Create my learner profile on this server"]
        try reveal(consent, app); consent.tap()
        try tap("Ask to join as a new learner", app)
        try tap("Finish joining", app, timeout: 120)
        try await event("joined")
        let originalRoom = try XCTUnwrap(configuration.roomId)
        XCTAssertTrue(app.otherElements["play.room.\(originalRoom)"].waitForExistence(timeout: 15))
        for order in 0..<6 {
            let header = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "ROUND \(order + 1) ·")).firstMatch
            XCTAssertTrue(header.waitForExistence(timeout: 30), app.debugDescription)
            let learner = order % 2 == 1
            let target = order == 2 ? "Brot" : "pan"
            if order < 2 {
                try reveal(app.buttons["play.choice.A"], app)
                app.buttons["play.choice.A"].tap()
                XCTAssertTrue(app.staticTexts["You picked the same answer."].waitForExistence(timeout: 30), app.debugDescription)
            } else if order < 4 {
                if learner {
                    try fill(app.textFields["play.draft.SET_TARGET"], target, app)
                    try tap("Keep this word secret", app)
                    try fill(app.textFields["play.draft.GIVE_CLUE"], "Ein Wort zum Essen.", app)
                    try tap("Send clue", app)
                } else {
                    try fill(app.textFields["play.draft.GUESS"], target, app)
                    try tap("Guess", app)
                    try tap("Understood", app)
                }
                XCTAssertTrue(app.staticTexts["2 points"].waitForExistence(timeout: 30), app.debugDescription)
                if learner {
                    try tap("Keep a word or sentence", app)
                    try fill(app.textFields["Word or sentence to keep"], target, app)
                    try tap("Save privately", app)
                    XCTAssertTrue(app.staticTexts["Saved privately to your notebook."].waitForExistence(timeout: 10), app.debugDescription)
                }
            } else {
                if !learner {
                    XCTAssertTrue(app.staticTexts["5 messages left together"].waitForExistence(timeout: 30), app.debugDescription)
                }
                for line in 0..<2 {
                    if line == 1 {
                        let remaining = learner ? 4 : 3
                        XCTAssertTrue(app.staticTexts["\(remaining) messages left together"].waitForExistence(timeout: 30), app.debugDescription)
                    }
                    try fill(app.textFields["play.draft.MESSAGE"], "Zusammen planen wir \(line + 1).", app)
                    try tap("Send line", app)
                }
                XCTAssertTrue(app.staticTexts["2 messages left together"].waitForExistence(timeout: 30), app.debugDescription)
                XCTAssertTrue(app.staticTexts["Plot twist"].exists)
                try tap("Yes, mission done", app)
                if !learner { try tap("Understood", app) }
                XCTAssertTrue(app.staticTexts["2 points"].waitForExistence(timeout: 30), app.debugDescription)
            }
            try await event("round", round: order)
        }
        XCTAssertTrue(app.staticTexts["Good game."].waitForExistence(timeout: 30), app.debugDescription)
        XCTAssertTrue(app.staticTexts["12 points"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "real-server-native-recap"
        attachment.lifetime = .keepAlways
        add(attachment)
        try tap("Play menu", app)
        try tap("Private notebook", app)
        XCTAssertTrue(app.staticTexts["pan"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertFalse(app.staticTexts["Brot"].exists)
        try tap("Play menu", app)
        try tap("Games", app)
        let completedGame = app.buttons.containing(.staticText, identifier: "Completed").firstMatch
        try reveal(completedGame, app); completedGame.tap()
        XCTAssertTrue(app.otherElements["play.room.\(originalRoom)"].waitForExistence(timeout: 15), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Good game."].waitForExistence(timeout: 15), app.debugDescription)
        try await event("completed")
        try tap("Open your rematch", app, timeout: 120)
        XCTAssertTrue(app.staticTexts["Your host will start when you are both ready."].waitForExistence(timeout: 15), app.debugDescription)
        let rematch = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@ AND identifier != %@",
            "play.room.", "play.room.\(originalRoom)")).firstMatch
        XCTAssertTrue(rematch.waitForExistence(timeout: 15), app.debugDescription)
        let successor = String(rematch.identifier.dropFirst("play.room.".count))
        XCTAssertFalse(successor.isEmpty)
        try await event("done", rematchId: successor)
        try tap("Close", app)
        try tap("Unpair this device", app)
        XCTAssertTrue(app.staticTexts["Pair this device"].waitForExistence(timeout: 10), app.debugDescription)
    }

    private func configuration() async throws -> Configuration {
        try JSONDecoder().decode(Configuration.self, from: await exchange())
    }

    private func event(_ type: String, round: Int? = nil, rematchId: String? = nil) async throws {
        var object: [String: Any] = ["type": type]
        if let round { object["round"] = round }
        if let rematchId { object["rematchId"] = rematchId }
        _ = try await exchange(JSONSerialization.data(withJSONObject: object))
    }

    private func exchange(_ body: Data? = nil) async throws -> Data {
        var request = URLRequest(url: try control)
        request.timeoutInterval = 5
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body { request.httpMethod = "POST"; request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertLessThanOrEqual(data.count, 8192)
        return data
    }

    private func fill(_ field: XCUIElement, _ value: String, _ app: XCUIApplication) throws {
        try reveal(field, app)
        field.tap(); field.typeText(value)
        app.swipeUp()
    }

    private func reveal(_ element: XCUIElement, _ app: XCUIApplication, timeout: TimeInterval = 30) throws {
        XCTAssertTrue(element.waitForExistence(timeout: timeout), app.debugDescription)
        for _ in 0..<12 {
            if element.isHittable { return }
            if element.frame.minY < app.frame.minY + 80 { app.swipeDown() }
            else { app.swipeUp() }
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }

    private func tap(_ title: String, _ app: XCUIApplication, timeout: TimeInterval = 30) throws {
        let button = app.buttons[title].firstMatch
        try reveal(button, app, timeout: timeout)
        let end = ContinuousClock.now.advanced(by: .seconds(timeout))
        while !button.isEnabled, ContinuousClock.now < end { Thread.sleep(forTimeInterval: 0.05) }
        XCTAssertTrue(button.isEnabled, app.debugDescription)
        button.tap()
    }
}
