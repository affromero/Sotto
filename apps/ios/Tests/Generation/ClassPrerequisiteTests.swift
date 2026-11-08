import XCTest
@testable import Sotto

@MainActor
final class ClassPrerequisiteTests: XCTestCase {
    private let sourceHash = String(repeating: "a", count: 64)

    func testHistoricalSpeakingAudioPathRejectsUntrustedIdentifiers() {
        XCTAssertEqual(speakingHistoryAudioPath(classId: "class-1", promptId: "prompt_1", recordingId: "recording"),
                       "/api/v1/classes/class-1/speaking/prompt_1/recordings/recording/audio")
        XCTAssertNil(speakingHistoryAudioPath(classId: "../other", promptId: "prompt", recordingId: "recording"))
        XCTAssertNil(speakingHistoryAudioPath(classId: "class", promptId: "prompt/other", recordingId: "recording"))
    }

    func testClassDetailDecodesPreviousWritingAndOlderServers() throws {
        let base: [String: Any] = [
            "id": "class", "courseId": "course", "status": "IN_PROGRESS",
            "order": 1, "passThreshold": 0.7, "submitted": false, "sections": []
        ]
        let old = try JSONDecoder().decode(SottoClassDetail.self, from: JSONSerialization.data(withJSONObject: base))
        XCTAssertNil(old.writingHistory)
        XCTAssertNil(old.speakingHistory)
        XCTAssertNil(old.quizHistory)
        var updated = base
        updated["speakingHistory"] = [[
            "sectionId": "old-speech", "attempt": 1,
            "prompts": [["id": "prompt", "order": 1, "targetPhrase": "Hallo", "translation": "Hello",
                         "recordings": [["id": "recording", "attempt": 1, "attemptMatches": true,
                                         "status": "SCORED", "transcript": "Hallo", "overallScore": 0.8,
                                         "rubricScores": ["accuracy": 0.8, "broken": "legacy"],
                                         "phonemeScores": [["op": "substitute", "expected": "r", "actual": "l"], ["bad": true]],
                                         "feedback": "Clear", "createdAt": "2026-01-01T00:00:00Z"]]]]
        ]]
        updated["speakingHistoryUnlinked"] = [["id": "unlinked", "attempt": 1, "status": "PENDING",
                                              "createdAt": "2026-01-01T00:00:00Z"]]
        updated["writingHistory"] = [[
            "sectionId": "old", "attempt": 2,
            "prompts": [["id": "prompt", "order": 1, "task": "Write a greeting",
                         "savedDraft": "New draft", "responses": [[
                            "id": "response", "text": "Hallo", "overallScore": 0.8,
                            "attempt": 1, "attemptMatches": false,
                            "corrections": [["old": "Hallo", "new": "Hallo!", "why": "Punctuation"], ["bad": "legacy"]],
                            "feedback": "Clear greeting", "createdAt": "2026-01-01T00:00:00Z"
                         ]]]]
        ]]
        updated["orphanWritingDrafts"] = [["id": "orphan", "text": "Saved words"]]
        updated["quizHistory"] = [[
            "sectionId": "old-quiz", "skill": "GRAMMAR", "attempt": 1,
            "questions": [["id": "q", "order": 1, "question": "Choose", "passageText": NSNull(),
                           "options": ["yes", "no"], "savedChoice": 0, "submissions": [[
                            "attempt": NSNull(), "submittedAt": NSNull(), "selectedIndex": 1, "isCorrect": false
                           ], ["attempt": NSNull(), "submittedAt": NSNull(), "selectedIndex": 0, "isCorrect": NSNull()],
                              ["attempt": 2, "submittedAt": NSNull(), "selectedIndex": NSNull(), "isCorrect": true]]]]
        ]]
        updated["orphanQuizAnswers"] = [["sectionId": NSNull(), "questionId": "missing", "savedChoice": 3, "submissions": []]]
        updated["quizHistoryUnreadable"] = true
        updated["quizSubmissionReceipts"] = [["attempt": 4, "submittedAt": NSNull(), "passed": false,
                                               "overallScore": 0.4, "answersUnavailable": true,
                                               "passedSections": 1, "totalSections": NSNull(),
                                               "sections": [["id": "speaking", "skill": "SPEAKING", "score": 0.8, "passed": true],
                                                            ["id": NSNull(), "skill": "READING", "score": 0.7, "passed": NSNull()]],
                                               "summaryIncomplete": true]]
        let detail = try JSONDecoder().decode(SottoClassDetail.self, from: JSONSerialization.data(withJSONObject: updated))
        XCTAssertEqual(detail.writingHistory?.first?.prompts.first?.savedDraft, "New draft")
        XCTAssertEqual(detail.speakingHistory?.first?.prompts.first?.recordings.first?.transcript, "Hallo")
        XCTAssertEqual(detail.speakingHistory?.first?.prompts.first?.recordings.first?.rubricScores["accuracy"], 0.8)
        XCTAssertEqual(detail.speakingHistory?.first?.prompts.first?.recordings.first?.phonemeScores.first?.expected, "r")
        XCTAssertEqual(detail.speakingHistory?.first?.prompts.first?.recordings.first?.detailsUnavailable, true)
        XCTAssertEqual(detail.speakingHistoryUnlinked?.first?.id, "unlinked")
        XCTAssertEqual(detail.writingHistory?.first?.prompts.first?.responses.first?.corrections?.first?.why, "Punctuation")
        XCTAssertEqual(detail.writingHistory?.first?.prompts.first?.responses.first?.correctionsUnavailable, true)
        XCTAssertEqual(detail.writingHistory?.first?.prompts.first?.responses.first?.attemptMatches, false)
        XCTAssertEqual(detail.orphanWritingDrafts?.first?.text, "Saved words")
        XCTAssertEqual(detail.quizHistory?.first?.questions.first?.savedChoice, 0)
        XCTAssertEqual(detail.quizHistory?.first?.questions.first?.submissions.first?.isCorrect, false)
        XCTAssertNil(detail.quizHistory?.first?.questions.first?.submissions.dropFirst().first?.isCorrect)
        XCTAssertNil(detail.quizHistory?.first?.questions.first?.submissions.last?.selectedIndex)
        XCTAssertEqual(detail.orphanQuizAnswers?.first?.savedChoice, 3)
        XCTAssertEqual(detail.quizHistoryUnreadable, true)
        XCTAssertEqual(detail.quizSubmissionReceipts?.first?.answersUnavailable, true)
        XCTAssertEqual(detail.quizSubmissionReceipts?.first?.sections.first?.skill, "SPEAKING")
        XCTAssertNil(detail.quizSubmissionReceipts?.first?.sections.last?.passed)
    }

    private func detail() throws -> SottoClassDetail {
        let body: [String: Any] = [
            "id": "class-1", "courseId": "course-1", "status": "IN_PROGRESS",
            "order": 1, "passThreshold": 0.7, "submitted": false, "prerequisiteSourceHash": sourceHash,
            "sections": [[
                "id": "section-1", "skill": "GRAMMAR", "status": "READY", "attempt": 1,
                "questions": [["id": "q1", "order": 1, "question": "Преврати сообщение в вопрос.", "options": ["A", "B"]]],
                "prompts": [], "writingPrompts": []
            ]]
        ]
        return try JSONDecoder().decode(SottoClassDetail.self, from: JSONSerialization.data(withJSONObject: body))
    }

    private func response(_ status: SottoClassPrerequisiteStatus, hash: String? = nil,
                          canRetry: Bool? = nil, recoverable: Bool? = nil,
                          tasks: [[String: String]]? = nil,
                          acknowledged: Bool = false) throws -> SottoClassPrerequisiteResponse {
        var body: [String: Any] = [
            "status": status.rawValue,
            "request": ["sourceHash": hash ?? self.sourceHash, "snapshotHash": String(repeating: "b", count: 64)],
            "nativeLang": "es", "targetLang": "ru"
        ]
        if let canRetry { body["canRetry"] = canRetry }
        if let recoverable { body["recoverable"] = recoverable }
        if status == .ready {
            body["receiptId"] = "00000000-0000-4000-a000-000000000001"
            body["acknowledged"] = acknowledged
            body["content"] = [
                "title": "Pedir", "explanation": "Usa cortesía.",
                "examples": [["target": "Вода", "meaning": "Agua", "explanation": "Una palabra."]],
                "directions": ["guided": "Haz una petición.", "tasks": tasks ?? [[
                    "sectionId": "section-1", "taskId": "q1", "kind": "question", "instruction": "Formula una pregunta."
                ]]]
            ]
        }
        return try JSONDecoder().decode(SottoClassPrerequisiteResponse.self, from: JSONSerialization.data(withJSONObject: body))
    }

    func testReadyDirectionsMatchTheExactClassAndTask() throws {
        let value = try response(.ready)
        try value.validate(for: detail())
        XCTAssertEqual(value.content?.directions.instruction(sectionId: "section-1", taskId: "q1", kind: .question), "Formula una pregunta.")
        XCTAssertNil(value.content?.directions.instruction(sectionId: "another", taskId: "q1", kind: .question))
        XCTAssertThrowsError(try response(.ready, hash: String(repeating: "c", count: 64)).validate(for: detail()))
        XCTAssertThrowsError(try response(.ready, tasks: []).validate(for: detail()))
        XCTAssertThrowsError(try response(.ready, tasks: [["sectionId": "section-1", "taskId": "other", "kind": "question", "instruction": "Lee."]]).validate(for: detail()))
        XCTAssertThrowsError(try response(.ready, tasks: [["sectionId": "section-1", "taskId": "q1", "kind": "writing", "instruction": "Lee."]]).validate(for: detail()))
        let duplicate = ["sectionId": "section-1", "taskId": "q1", "kind": "question", "instruction": "Lee."]
        XCTAssertThrowsError(try response(.ready, tasks: [duplicate, duplicate]).validate(for: detail()))
    }

    func testOnlyExplicitPreparationCanStartAvailableWork() async throws {
        let available = try response(.available)
        let ready = try response(.ready)
        let inspect = ClassPrerequisiteLoader(detail: try detail(), read: { available }, start: { _ in
            XCTFail("Reading status must not dispatch paid work")
            return ready
        })
        let inspected = try await inspect.load(prepare: false) { _ in }
        XCTAssertEqual(inspected.status, .available)
        let prepare = ClassPrerequisiteLoader(detail: try detail(), read: { available }, start: { request in
            XCTAssertEqual(request, available.request)
            return ready
        })
        let prepared = try await prepare.load(prepare: true) { _ in }
        XCTAssertEqual(prepared.status, .ready)
    }

    func testPendingRecoveryReusesTheExactRequest() async throws {
        let pending = try response(.pending, recoverable: true)
        let ready = try response(.ready)
        var updates: [SottoClassPrerequisiteStatus] = []
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: { pending }, start: { request in
            XCTAssertEqual(request, pending.request)
            return ready
        }, pause: {})
        let result = try await loader.load(prepare: false) { updates.append($0.status) }
        XCTAssertEqual(result.status, .ready)
        XCTAssertEqual(updates, [.pending, .ready])
    }

    func testStaleAndUnresolvedResultsCannotStartAnotherRequest() async throws {
        for value in try [response(.failed, canRetry: false), response(.unresolved)] {
            let loader = ClassPrerequisiteLoader(detail: try detail(), read: { value }, start: { _ in
                XCTFail("Unresolved work must stay fenced")
                return value
            })
            let inspected = try await loader.load(prepare: true) { _ in }
            XCTAssertEqual(inspected.status, value.status)
        }
        let staleHash = try response(.available, hash: String(repeating: "c", count: 64))
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: { staleHash }, start: { _ in staleHash })
        do {
            _ = try await loader.load(prepare: true) { _ in XCTFail("Stale data reached the view") }
            XCTFail("Stale data was accepted")
        } catch {
            XCTAssertEqual(error.localizedDescription, "The class changed. Reopen the class before viewing this explanation.")
        }
    }

    func testPendingWithoutRecoveryOnlyReadsStatus() async throws {
        let pending = try response(.pending)
        let ready = try response(.ready)
        var firstRead = true
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: {
            if firstRead { firstRead = false; return pending }
            return ready
        }, start: { _ in
            XCTFail("A pending request must not admit new work")
            return pending
        }, pause: {})
        let result = try await loader.load(prepare: true) { _ in }
        XCTAssertEqual(result.status, .ready)
    }

    func testPollingTimeoutDoesNotStartNewWork() async throws {
        let pending = try response(.pending)
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: { pending }, start: { _ in
            XCTFail("A timeout must not start another request")
            return pending
        }, pause: {}, timeout: .zero)
        do {
            _ = try await loader.load(prepare: false) { _ in }
            XCTFail("Pending work should time out")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("Check the saved status"))
        }
    }

    func testCancelledReadCannotPublishItsLateResponse() async throws {
        let ready = try response(.ready)
        var pendingRead: CheckedContinuation<SottoClassPrerequisiteResponse, Never>?
        var published = false
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: {
            await withCheckedContinuation { pendingRead = $0 }
        }, start: { _ in ready })
        let task = Task {
            try await loader.load(prepare: false) { _ in published = true }
        }
        while pendingRead == nil { await Task.yield() }
        task.cancel()
        pendingRead?.resume(returning: ready)
        do {
            _ = try await task.value
            XCTFail("A cancelled load must not accept its late response")
        } catch is CancellationError {
            XCTAssertFalse(published)
        }
    }

    func testCancelledAcknowledgmentCannotPublishItsLateResponse() async throws {
        let ready = try response(.ready, acknowledged: true)
        let request = SottoClassPrerequisiteAcknowledgment(sourceHash: sourceHash,
            receiptId: "00000000-0000-4000-a000-000000000001")
        var pending: CheckedContinuation<SottoClassPrerequisiteResponse, Never>?
        var published = false
        let loader = ClassPrerequisiteLoader(detail: try detail(), read: { ready }, start: { _ in ready })
        let task = Task {
            try await loader.acknowledge(request, perform: { sent in
                XCTAssertEqual(sent, request)
                return await withCheckedContinuation { pending = $0 }
            }) { _ in published = true }
        }
        while pending == nil { await Task.yield() }
        task.cancel()
        pending?.resume(returning: ready)
        do {
            _ = try await task.value
            XCTFail("A cancelled acknowledgment must not publish its late response")
        } catch is CancellationError {
            XCTAssertFalse(published)
        }
    }

    func testAuthenticatedTransportUsesTheExactServerRequest() async throws {
        let client = ClassPrerequisiteProtocol.makeClient()
        let available = try await client.fetchClassPrerequisite(classId: "class-1")
        let pending = try await client.startClassPrerequisite(classId: "class-1", request: available.request)
        XCTAssertEqual(pending.status, .pending)
        XCTAssertEqual(pending.request, available.request)
        let acknowledged = try await client.acknowledgeClassPrerequisite(classId: "class-1", request:
            SottoClassPrerequisiteAcknowledgment(sourceHash: available.request.sourceHash,
                receiptId: "00000000-0000-4000-a000-000000000001"))
        XCTAssertEqual(acknowledged.receiptId, "00000000-0000-4000-a000-000000000001")
        XCTAssertEqual(acknowledged.acknowledged, true)
        let displayed = SottoClassPrerequisiteAcknowledgment(sourceHash: sourceHash,
            receiptId: "00000000-0000-4000-a000-000000000001")
        try acknowledged.validateAcknowledgment(displayed, for: detail())
        let replaced = SottoClassPrerequisiteAcknowledgment(sourceHash: sourceHash,
            receiptId: "00000000-0000-4000-a000-000000000002")
        XCTAssertThrowsError(try acknowledged.validateAcknowledgment(replaced, for: detail()))
        XCTAssertThrowsError(try response(.ready).validateAcknowledgment(displayed, for: detail()))
    }

    func testProviderSetupErrorPointsToTheWebApp() {
        let result = SottoClassPrerequisiteFailure.normalized(SottoAPIError.message("No provider configured"))
        XCTAssertEqual(result.localizedDescription, "Set up the AI provider on your Sotto web app, then try again.")
        let ordinary = SottoClassPrerequisiteFailure.normalized(SottoAPIError.http(422, "This class is too large to prepare safely."))
        guard case SottoAPIError.http(422, _) = ordinary else {
            return XCTFail("The client must preserve the capacity status")
        }
    }
}

private final class ClassPrerequisiteProtocol: URLProtocol {
    static let response = #"{"status":"AVAILABLE","request":{"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","snapshotHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"nativeLang":"es","targetLang":"ru"}"#

    static func makeClient() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ClassPrerequisiteProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "help-key", profileId: "learner", session: URLSession(configuration: configuration))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let isAcknowledgment = request.url?.path.hasSuffix("/acknowledge") == true
        XCTAssertEqual(request.url?.path, isAcknowledgment ? "/api/v1/classes/class-1/prerequisite/acknowledge" : "/api/v1/classes/class-1/prerequisite")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer help-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
        XCTAssertFalse(request.httpShouldHandleCookies)
        let isPost = request.httpMethod == "POST"
        if !isPost { XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData) }
        if isPost {
            do {
                let captured = try request.capturingNativeTestBody()
                guard let data = captured.httpBody,
                      let body = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
                    throw URLError(.cannotDecodeRawData)
                }
                if isAcknowledgment {
                    XCTAssertEqual(body, ["sourceHash": String(repeating: "a", count: 64), "receiptId": "00000000-0000-4000-a000-000000000001"])
                } else {
                    XCTAssertEqual(body, ["sourceHash": String(repeating: "a", count: 64), "snapshotHash": String(repeating: "b", count: 64)])
                }
            } catch {
                XCTFail("Could not read prerequisite admission: \(error)")
                client?.urlProtocol(self, didFailWithError: error)
                return
            }
        }
        let body = isAcknowledgment
            ? Self.response.replacingOccurrences(of: "AVAILABLE", with: "READY").replacingOccurrences(of: #""targetLang":"ru""#, with: #""targetLang":"ru","receiptId":"00000000-0000-4000-a000-000000000001","acknowledged":true,"content":{"title":"Pedir","explanation":"Usa cortesía.","examples":[{"target":"Вода","meaning":"Agua","explanation":"Una palabra."}],"directions":{"guided":"Haz una petición.","tasks":[{"sectionId":"section-1","taskId":"q1","kind":"question","instruction":"Formula una pregunta."}]}}"#)
            : (isPost ? Self.response.replacingOccurrences(of: "AVAILABLE", with: "PENDING") : Self.response)
        let response = HTTPURLResponse(url: request.url!, statusCode: isPost && !isAcknowledgment ? 202 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
