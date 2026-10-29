import XCTest
@testable import Sotto

@MainActor
final class ClassLessonHelpLoaderTests: XCTestCase {
    private let teaching = SottoClassTeaching(
        version: 1,
        title: "Meinung",
        explanation: "Erklären",
        workedExamples: [
            SottoWorkedExample(prompt: "Frage", answer: "Ja", explanation: "Grund"),
            SottoWorkedExample(prompt: "Andere", answer: "Nein", explanation: "Grund")
        ],
        commonMistake: SottoCommonMistake(incorrect: "Nein", correction: "Ja", explanation: "Grund"),
        guidedPractice: SottoGuidedPractice(prompt: "Frage", hint: "Hinweis", answer: "Ja", explanation: "Grund")
    )

    private func response(
        _ status: SottoClassLessonHelpStatus,
        hash: String? = nil,
        canRetry: Bool = false,
        examples: Int = 2
    ) throws -> SottoClassLessonHelpResponse {
        let example = ["prompt": "Prompt", "meaning": "Meaning", "explanation": "Explanation"]
        let help: [String: Any] = [
            "title": "English help", "explanation": "English explanation",
            "workedExamples": Array(repeating: example, count: examples),
            "correctionExplanation": "Correction", "guidedPrompt": "Try", "guidedHint": "Hint"
        ]
        var body: [String: Any] = [
            "status": status.rawValue,
            "request": [
                "operationId": "2c157df4-a35d-4e3f-bbd6-670d9b200e2f",
                "attempt": 2, "sourceHash": hash ?? teaching.sourceHash, "retryOf": NSNull()
            ],
            "nativeLang": "en", "targetLang": "de", "canRetry": canRetry
        ]
        if status == .ready { body["help"] = help }
        if status == .failed { body["error"] = "Preparation failed" }
        return try JSONDecoder().decode(SottoClassLessonHelpResponse.self, from: JSONSerialization.data(withJSONObject: body))
    }

    func testAvailableHelpIsPreparedAndPolledUntilReady() async throws {
        let available = try response(.available)
        let pending = try response(.pending)
        let ready = try response(.ready)
        var reads = [available, ready]
        var updates: [SottoClassLessonHelpStatus] = []
        let loader = ClassLessonHelpLoader(
            teaching: teaching,
            read: { reads.removeFirst() },
            start: { request in
                XCTAssertEqual(request, available.request)
                return pending
            },
            pause: {}
        )
        let value = try await loader.load(retry: false) { updates.append($0.status) }
        XCTAssertEqual(value.help?.title, "English help")
        XCTAssertEqual(updates, [.available, .pending, .ready])
    }

    func testExistingHelpOpensWithoutStartingAnotherRequest() async throws {
        let ready = try response(.ready)
        let loader = ClassLessonHelpLoader(teaching: teaching, read: { ready }, start: { _ in
            XCTFail("Already prepared help must not be regenerated")
            return ready
        })
        let value = try await loader.load(retry: false) { _ in }
        XCTAssertEqual(value.help?.explanation, "English explanation")
    }

    func testFailedHelpRequiresExplicitRetryAndRetryableStatus() async throws {
        let failed = try response(.failed, canRetry: true)
        let ready = try response(.ready)
        let inspect = ClassLessonHelpLoader(teaching: teaching, read: { failed }, start: { _ in
            XCTFail("Checking a failure must not start a retry")
            return ready
        })
        let inspected = try await inspect.load(retry: false) { _ in }
        XCTAssertTrue(inspected.error?.contains("failed") == true)

        let retry = ClassLessonHelpLoader(teaching: teaching, read: { failed }, start: { request in
            XCTAssertEqual(request, failed.request)
            return ready
        })
        let recovered = try await retry.load(retry: true) { _ in }
        XCTAssertEqual(recovered.help?.title, "English help")

        let blocked = try response(.failed, canRetry: false)
        let noRetry = ClassLessonHelpLoader(teaching: teaching, read: { blocked }, start: { _ in
            XCTFail("A non-retryable failure must remain unchanged")
            return ready
        })
        let unchanged = try await noRetry.load(retry: true) { _ in }
        XCTAssertTrue(unchanged.error?.contains("failed") == true)
    }

    func testStaleLessonAndMismatchedExamplesNeverReachTheView() async throws {
        for invalid in try [response(.available, hash: String(repeating: "a", count: 64)), response(.ready, examples: 3)] {
            var updates: [SottoClassLessonHelpStatus] = []
            let loader = ClassLessonHelpLoader(teaching: teaching, read: { invalid }, start: { _ in
                XCTFail("Invalid help must not be admitted")
                return invalid
            })
            do {
                _ = try await loader.load(retry: false) { updates.append($0.status) }
                XCTFail("Invalid help was accepted")
            } catch {
                XCTAssertFalse(error.localizedDescription.isEmpty)
            }
            XCTAssertTrue(updates.isEmpty)
        }
    }

    func testCancellationDuringPollingStopsFurtherReadsAndUpdates() async throws {
        let pending = try response(.pending)
        var updates: [SottoClassLessonHelpStatus] = []
        let loader = ClassLessonHelpLoader(teaching: teaching, read: { pending }, start: { _ in pending }, pause: {
            withUnsafeCurrentTask { $0?.cancel() }
            try Task.checkCancellation()
        })
        let task = Task {
            try await loader.load(retry: false) { updates.append($0.status) }
        }
        do {
            _ = try await task.value
            XCTFail("Cancelled polling returned a response")
        } catch is CancellationError {
            XCTAssertEqual(updates, [.pending])
        }
    }

    func testAdmissionFailurePropagatesAndRetainsLastConfirmedState() async throws {
        let available = try response(.available)
        var updates: [SottoClassLessonHelpStatus] = []
        let loader = ClassLessonHelpLoader(teaching: teaching, read: { available }, start: { _ in
            throw SottoAPIError.message("Server unavailable")
        })
        do {
            _ = try await loader.load(retry: false) { updates.append($0.status) }
            XCTFail("Failed admission returned a response")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Server unavailable"))
            XCTAssertEqual(updates, [.available])
        }
    }

    func testPendingHelpTimesOutWithoutPollingAgain() async throws {
        let pending = try response(.pending)
        let loader = ClassLessonHelpLoader(teaching: teaching, read: { pending }, start: { _ in pending }, pause: {
            XCTFail("Expired help should not poll")
        }, timeout: .zero)
        do {
            _ = try await loader.load(retry: false) { _ in }
            XCTFail("Expired help returned a response")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("taking longer"))
        }
    }
}
