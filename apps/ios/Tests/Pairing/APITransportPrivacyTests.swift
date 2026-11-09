import Network
import XCTest

@testable import Sotto

private final class VocabularyTransportProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let captured = try request.capturingNativeTestBody()
            let body = try XCTUnwrap(captured.httpBody)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer practice-secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
            switch request.url?.path {
            case "/api/v1/courses/course/vocabulary/study":
                XCTAssertEqual(json["requestId"] as? String, "3c6d131f-4d72-47e5-8431-d0588d4e8609")
                XCTAssertEqual(json["mode"] as? String, "FLASHCARDS")
                XCTAssertEqual(json["wordIds"] as? [String], ["word-1"])
            case "/api/v1/practice/study/vocabulary":
                XCTAssertEqual(json["expectedRevision"] as? Int, 2)
                XCTAssertEqual(json["action"] as? String, "REVEAL")
                XCTAssertEqual(json["itemId"] as? String, "card")
            default: XCTFail("Unexpected vocabulary path: \(request.url?.path ?? "")")
            }
            let data = Data(#"{"status":"ready_vocabulary","kind":"VOCAB","sessionId":"study","courseId":"course","mode":"FLASHCARDS","progressRevision":2,"writingDrafts":{},"cards":[{"id":"card","prompt":"Haus","feedback":null}],"receipt":null}"#.utf8)
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private final class VocabularyProgressProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"saved":true,"progressRevision":5}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class VocabularyDictionaryProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer practice-secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
            let data: Data
            if request.httpMethod == "GET" {
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
                XCTAssertEqual(query?.first(where: { $0.name == "search" })?.value, "Straße & Haus")
                XCTAssertEqual(query?.first(where: { $0.name == "state" })?.value, "due")
                XCTAssertEqual(query?.first(where: { $0.name == "page" })?.value, "2")
                data = Data(#"{"words":[{"id":"word","lemma":"Haus","translation":"house","acceptedMeanings":["home"],"partOfSpeech":null,"state":"due","mastery":0.4,"reviews":2,"dueAt":null,"lastReviewed":null,"sourceCount":0,"sources":[]}],"total":1,"page":2,"pages":2,"counts":{"unseen":0,"due":1,"strong":0},"vocabularySupport":"WORD_RECALL","materials":[]}"#.utf8)
            } else {
                let body = try XCTUnwrap(request.capturingNativeTestBody().httpBody)
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(request.url?.path, "/api/v1/courses/course/vocabulary/word")
                XCTAssertEqual(json["translation"] as? String, "house")
                XCTAssertEqual(json["acceptedMeanings"] as? [String], ["home"])
                data = Data(#"{"saved":true}"#.utf8)
            }
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class APITransportPrivacyTests: XCTestCase {
    @MainActor
    func testClassRecordingIsNotSentAfterLearnerChanges() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"recordingId":"unexpected"}"#) }
        try await server.start()
        defer { server.stop() }
        let profile = SottoProfile(id: "second", name: "Second", avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
        let model = SottoAppModel(credentials: SottoCredentials(serverURL: server.url, apiKey: "secret", user: nil, selectedProfile: profile), session: URLSession(configuration: .ephemeral))
        let original = SottoLearnerIdentity(SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "first"))
        do {
            _ = try await model.uploadClassSpeakingRecording(classId: "class", promptId: "prompt",
                audioURL: URL(fileURLWithPath: "/unused"),
                binding: SottoClassSpeakingBinding(attempt: 1, materialRevision: String(repeating: "a", count: 64)),
                expectedLearner: original)
            XCTFail("A recording must remain with its original learner")
        } catch SottoAPIError.classRecordingRejected(_) {
            XCTAssertTrue(server.requests.isEmpty)
        }
        do {
            _ = try await model.latestSpeakingRecording(source: .practice(sessionId: "session"),
                promptId: "prompt", expectedLearner: original)
            XCTFail("A recording must not be recovered under another learner")
        } catch is CancellationError {
            XCTAssertTrue(server.requests.isEmpty)
        }
    }

    @MainActor
    func testLateClassUploadReceiptDoesNotCrossLearners() async throws {
        let server = try LocalHTTPServer { _ in
            .init(status: 201, headers: [:], body: #"{"recordingId":"saved","status":"PENDING"}"#, delay: 0.5)
        }
        try await server.start()
        defer { server.stop() }
        let first = PlayTestIdentity.connection(server: server.url, id: "first")
        let second = PlayTestIdentity.connection(server: server.url, id: "second")
        let model = SottoAppModel(credentials: first, session: URLSession(configuration: .ephemeral),
            credentialStore: PlayCredentialMemoryStore())
        let owner = SottoLearnerIdentity(try XCTUnwrap(model.makeClient()))
        let audio = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".wav")
        try Data("RIFF sample audio".utf8).write(to: audio)
        defer { try? FileManager.default.removeItem(at: audio) }
        let upload = Task {
            try await model.uploadClassSpeakingRecording(classId: "class", promptId: "prompt", audioURL: audio,
                binding: SottoClassSpeakingBinding(attempt: 1, materialRevision: String(repeating: "a", count: 64)),
                expectedLearner: owner)
        }
        for _ in 0..<100 where server.requests.isEmpty { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertEqual(server.requests.count, 1)
        try model.persistCredentials(second)
        do {
            _ = try await upload.value
            XCTFail("A late receipt must not update another learner")
        } catch is CancellationError {
            XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
        }
    }

    @MainActor
    func testCredentialRotationKeepsPendingSpeakingAndReopensCleanPrompts() throws {
        let server = URL(string: "https://school.example")!
        let profile = PlayTestIdentity.profile("learner")
        let original = SottoCredentials(serverURL: server, apiKey: "old", user: nil, selectedProfile: profile)
        let model = SottoAppModel(credentials: original, credentialStore: PlayCredentialMemoryStore())
        let state = model.learningSessionState(path: "/api/v1/classes/class", attempt: 1, revision: 0)
        let clean = model.speakingState(source: .classSession(classId: "class"), promptId: "clean")
        let pending = model.speakingState(source: .classSession(classId: "class"), promptId: "pending")
        let previousOwner = try XCTUnwrap(pending.recordingOwner)
        pending.uploadUnknown = true
        try model.persistCredentials(SottoCredentials(serverURL: server, apiKey: "new", user: nil, selectedProfile: profile))
        let reopened = model.learningSessionState(path: "/api/v1/classes/class", attempt: 1, revision: 0)
        let currentOwner = SottoLearnerIdentity(try XCTUnwrap(model.makeClient()))
        XCTAssertTrue(reopened === state)
        XCTAssertEqual(reopened.owner, currentOwner)
        XCTAssertEqual(clean.recordingOwner, currentOwner)
        XCTAssertEqual(pending.recordingOwner, previousOwner)
        XCTAssertFalse(pending.canRecord)
    }
    func testProofOnlyGamePostRejectsSameOriginRedirectsWithoutCookiesBearerOrBrowserOrigin() async throws {
        let server = try LocalHTTPServer { _ in .init(status: 307, headers: ["Location": "/api/v1/play/retargeted"], body: "") }
        try await server.start()
        defer { server.stop() }
        let configuration = URLSessionConfiguration.ephemeral
        let cookie = try XCTUnwrap(HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "household", .value: "owner-cookie"]))
        configuration.httpCookieStorage?.setCookie(cookie)
        let client = SottoAPIClient(serverURL: server.url, apiKey: "owner-device", profileId: "owner", session: URLSession(configuration: configuration))
        do {
            let _: [String: Bool] = try await client.play("/api/v1/play/invitations", body: Data("{}".utf8),
                proof: "claimant-proof", authorized: false)
            XCTFail("A game proof must not follow redirects.")
        } catch let SottoAPIError.http(status, _) {
            XCTAssertEqual(status, 307, "Server received \(server.requests.count) requests")
        } catch {
            XCTFail("Expected a refused redirect, got \(error); server received \(server.requests.count) requests")
        }
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.hasPrefix("POST /api/v1/play/invitations "))
        XCTAssertFalse(server.requests.contains { $0.contains("retargeted") })
        XCTAssertFalse(request.lowercased().contains("authorization:"))
        XCTAssertFalse(request.lowercased().contains("cookie:"))
        XCTAssertFalse(request.lowercased().contains("origin:"))
        XCTAssertTrue(request.lowercased().contains("x-sotto-play-proof: claimant-proof"))
    }

    func testPrivateGameResponsesAreNotStoredInTheSessionsResponseCache() async throws {
        let server = try LocalHTTPServer { _ in .init(status: 200, headers: ["Cache-Control": "public, max-age=3600"], body: "{\"ok\":true}") }
        try await server.start()
        defer { server.stop() }
        let configuration = URLSessionConfiguration.ephemeral
        let cache = URLCache(memoryCapacity: 1_000_000, diskCapacity: 0)
        configuration.urlCache = cache
        let client = SottoAPIClient(serverURL: server.url, apiKey: "member-device", profileId: "learner", session: URLSession(configuration: configuration))
        let result: [String: Bool] = try await client.play("/api/v1/play/rooms")
        XCTAssertEqual(result["ok"], true)
        let url = try XCTUnwrap(URL(string: "/api/v1/play/rooms", relativeTo: server.url))
        XCTAssertNil(cache.cachedResponse(for: URLRequest(url: url)))
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.lowercased().contains("authorization: bearer member-device"))
        XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"))
        XCTAssertTrue(request.lowercased().contains("x-sotto-play-profile: learner"))
    }

    func testPracticeConfigurationFailurePointsToTheWebApp() async throws {
        let server = try LocalHTTPServer { _ in
            .init(status: 500, headers: [:], body: #"{"error":"A provider API_KEY is not configured"}"#)
        }
        try await server.start(); defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "native-key", profileId: "learner", session: URLSession(configuration: .ephemeral))
        do { _ = try await client.startPractice(courseId: "course", kind: "GRAMMAR"); XCTFail("Expected server configuration failure") }
        catch {
            XCTAssertTrue(error.localizedDescription.contains("web app"))
            XCTAssertFalse(error.localizedDescription.contains("API_KEY"))
        }
    }
    func testMaterialReceiptRedirectKeepsTheFrozenProfileAssertionOnThePairedOrigin() async throws {
        struct Receipt: Decodable { let id: String }
        let server = try LocalHTTPServer { request in
            if request.hasPrefix("GET /material-final ") { return .json(#"{"id":"learner"}"#) }
            return .init(status: 307, headers: ["Location": "/material-final"], body: "")
        }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "material-key", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let receipt: Receipt = try await client.materialRequest("/api/v1/users/me")
        XCTAssertEqual(receipt.id, "learner")
        XCTAssertEqual(server.requests.count, 2)
        for request in server.requests {
            XCTAssertTrue(request.lowercased().contains("x-sotto-expected-profile-id: learner"))
            XCTAssertTrue(request.lowercased().contains("authorization: bearer material-key"))
            XCTAssertFalse(request.lowercased().contains("cookie:"))
        }
    }
    func testPencilReviewSendsTheImageToThePairedServerAndKeepsItsRetryIdentity() async throws {
        let id = UUID()
        let server = try LocalHTTPServer { _ in .init(status: 202, headers: [:], body: "{\"status\":\"PENDING\",\"operationId\":\"\(id.uuidString)\"}") }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "pencil-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let answer = SottoPencilRequest(requestId: id, attempt: 3, taskKind: "QUESTION", taskId: "q1", image: "data:image/png;base64,aW5r")
        let first = try await client.requestPencilInterpretation(classId: "class-1", answer: answer)
        let retry = try await client.requestPencilInterpretation(classId: "class-1", answer: answer)
        XCTAssertEqual(first.operationId, retry.operationId)
        for request in server.requests {
            XCTAssertTrue(request.hasPrefix("POST /api/v1/classes/class-1/pencil "))
            XCTAssertTrue(request.lowercased().contains("authorization: bearer pencil-secret"))
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"))
            let body = try XCTUnwrap(request.components(separatedBy: "\r\n\r\n").last?.data(using: .utf8))
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["image"] as? String, answer.image)
            XCTAssertEqual(json["requestId"] as? String, id.uuidString)
            XCTAssertEqual(json["attempt"] as? Int, 3)
        }
    }

    func testSameOriginMediaRedirectRetainsBearerWithoutCookies() async throws {
        let server = try LocalHTTPServer { request in
            if request.hasPrefix("GET /audio-final ") {
                return .init(status: 200, headers: ["Content-Type": "audio/mpeg"], body: "audio bytes")
            }
            return .init(status: 307, headers: ["Location": "/audio-final"], body: "")
        }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "media-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let audio = try await client.downloadLearningAudio(from: "/audio")
        defer { try? FileManager.default.removeItem(at: audio) }
        XCTAssertEqual(try Data(contentsOf: audio), Data("audio bytes".utf8))
        XCTAssertEqual(server.requests.count, 2)
        for request in server.requests {
            XCTAssertTrue(request.lowercased().contains("authorization: bearer media-secret"), request)
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"), request)
            XCTAssertFalse(request.lowercased().contains("cookie:"), request)
        }
    }

    func testPracticeAdmissionAccepts202AndRetainsTheRequestUUIDOnRetry() async throws {
        let requestID = UUID()
        let body = "{\"status\":\"preparing\",\"sessionId\":\"\(requestID.uuidString)\",\"preparationStatus\":\"QUEUED\",\"message\":\"Saved\",\"canRecover\":false}"
        let server = try LocalHTTPServer { _ in .init(status: 202, headers: [:], body: body) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let first = try await client.startPractice(courseId: "course", kind: "FULL", requestId: requestID)
        let retry = try await client.startPractice(courseId: "course", kind: "FULL", requestId: requestID)
        XCTAssertEqual(first.sessionId, retry.sessionId)
        for request in server.requests {
            let json = try XCTUnwrap(request.components(separatedBy: "\r\n\r\n").last).data(using: .utf8)
            let payload = try JSONSerialization.jsonObject(with: XCTUnwrap(json)) as? [String: String]
            XCTAssertEqual(payload?["requestId"], requestID.uuidString)
            XCTAssertEqual(payload?["kind"], "FULL")
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"))
        }
    }

    func testVocabularyStudyUsesTheSharedStudyAndAnswerEndpoints() async throws {
        let requestID = UUID(uuidString: "3C6D131F-4D72-47E5-8431-D0588D4E8609")!
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VocabularyTransportProtocol.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: configuration))
        let session = try await client.startVocabularyStudy(courseId: "course", requestId: requestID, mode: .flashcards, wordIds: ["word-1"])
        XCTAssertEqual(session.cards?.first?.prompt, "Haus")
        _ = try await client.vocabularyAction(sessionId: session.sessionId,
            action: SottoVocabularyAction(action: "REVEAL", expectedRevision: 2, itemId: "card"))
    }

    func testVocabularyExamplesUseTheOwnedSessionAndRetainRequestIdentity() async throws {
        let body = #"{"status":"PENDING","request":{"operationId":"00000000-0000-4000-8000-000000000001","retryOf":null,"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"canRetry":false}"#
        let server = try LocalHTTPServer { _ in .init(status: 200, headers: [:], body: body) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let path = "/api/v1/practice/study/vocabulary/card/examples"
        let status = try await client.vocabularyExamples(path: path)
        _ = try await client.prepareVocabularyExamples(path: path, request: status.request)
        XCTAssertEqual(status.request.operationId, "00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(server.requests.count, 2)
        for request in server.requests {
            XCTAssertTrue(request.contains(path))
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"))
        }
        XCTAssertTrue(server.requests[1].contains(status.request.sourceHash))
    }

    func testDictionarySearchAndMeaningEditsUseTheOwnedCourse() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VocabularyDictionaryProtocol.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: configuration))
        let dictionary = try await client.vocabularyDictionary(courseId: "course", search: "Straße & Haus", state: "due", page: 2)
        XCTAssertEqual(dictionary.words.first?.lemma, "Haus")
        XCTAssertEqual(dictionary.vocabularySupport, "WORD_RECALL")
        try await client.saveVocabularyMeaning(courseId: "course", wordId: "word", meaning: SottoVocabularyMeaning(translation: "house", acceptedMeanings: ["home"]))
    }

    @MainActor
    func testVocabularyAnswerWaitsForTheSavedDraftRevision() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [VocabularyProgressProtocol.self]
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: configuration))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/practice/study", revision: 4)
        progress.update(answers: [:], writingDrafts: ["card": "house"])
        let revision = try await progress.flushRevision()
        XCTAssertEqual(revision, 5)
        XCTAssertNil(progress.errorMessage)
    }

    func testClassRegenerationAccepts202AndPinsTheObservedAttempt() async throws {
        let server = try LocalHTTPServer { _ in
            .init(status: 202, headers: [:], body: #"{"started":true,"status":"GENERATING","scope":"class","operationId":"9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac","courseId":"course"}"#)
        }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "class-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let accepted = try await client.startClassRegeneration(classId: "class-saved", expectedAttempt: 4)
        XCTAssertEqual(accepted.operationId, "9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac")
        XCTAssertEqual(accepted.courseId, "course")
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.hasPrefix("POST /api/v1/classes/class-saved?background=1 "))
        let json = try XCTUnwrap(request.components(separatedBy: "\r\n\r\n").last).data(using: .utf8)
        let payload = try JSONSerialization.jsonObject(with: XCTUnwrap(json)) as? [String: Any]
        XCTAssertEqual(payload?["expectedAttempt"] as? Int, 4)
        XCTAssertEqual(payload?["scope"] as? String, "class")
    }

    func testProgressSavesAllAnswersAndDraftsAtTheExpectedRevision() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"saved":true,"progressRevision":4}"#) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let saved = try await client.saveLearningProgress(path: "/api/v1/practice/saved",
            expectedRevision: 3, answers: ["g0": 2, "v0": 1], writingDrafts: ["w0": "Hola\nAna"])
        XCTAssertEqual(saved.progressRevision, 4)
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.hasPrefix("PATCH /api/v1/practice/saved "))
        let json = try XCTUnwrap(request.components(separatedBy: "\r\n\r\n").last).data(using: .utf8)
        let payload = try JSONSerialization.jsonObject(with: XCTUnwrap(json)) as? [String: Any]
        XCTAssertEqual(payload?["expectedRevision"] as? Int, 3)
        XCTAssertEqual(payload?["answers"] as? [String: Int], ["g0": 2, "v0": 1])
        XCTAssertEqual(payload?["writingDrafts"] as? [String: String], ["w0": "Hola\nAna"])
    }

    func testClassSpeakingUploadPinsAttemptAndMaterialWhilePracticeRemainsUnchanged() async throws {
        let server = try LocalHTTPServer { _ in
            .init(status: 201, headers: [:], body: #"{"recordingId":"recording","status":"PENDING"}"#)
        }
        try await server.start()
        defer { server.stop() }
        let audio = FileManager.default.temporaryDirectory.appendingPathComponent("speaking-test-\(UUID().uuidString).wav")
        try Data("RIFF sample audio".utf8).write(to: audio)
        defer { try? FileManager.default.removeItem(at: audio) }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "speaking-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let revision = String(repeating: "a", count: 64)
        do {
            _ = try await client.uploadClassSpeakingRecording(classId: "class", promptId: "prompt", audioURL: audio,
                binding: SottoClassSpeakingBinding(attempt: 0, materialRevision: revision))
            XCTFail("An invalid class binding must not be uploaded")
        } catch { XCTAssertTrue(server.requests.isEmpty) }
        _ = try await client.uploadClassSpeakingRecording(classId: "class", promptId: "prompt", audioURL: audio,
            binding: SottoClassSpeakingBinding(attempt: 4, materialRevision: revision))
        _ = try await client.uploadPracticeSpeakingRecording(sessionId: "session", promptId: "prompt", audioURL: audio)
        XCTAssertEqual(server.requests.count, 2)
        let classRequest = server.requests[0]
        XCTAssertTrue(classRequest.hasPrefix("POST /api/v1/classes/class/speaking/prompt "))
        XCTAssertTrue(classRequest.contains("name=\"audio\""))
        XCTAssertTrue(classRequest.contains("name=\"expectedAttempt\"\r\n\r\n4"))
        XCTAssertTrue(classRequest.contains("name=\"taskMaterialRevision\"\r\n\r\n\(revision)"))
        XCTAssertTrue(classRequest.lowercased().contains("authorization: bearer speaking-secret"))
        XCTAssertFalse(server.requests[1].contains("expectedAttempt"))
        XCTAssertFalse(server.requests[1].contains("taskMaterialRevision"))
    }

    func testOnlyTypedPrepublicationRejectionsAreDefinite() throws {
        let client = SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "key")
        let url = URL(string: "https://school.example/api/v1/classes/class/speaking/prompt")!
        let data = Data(#"{"error":"The class changed.","code":"CLASS_MATERIAL_CHANGED"}"#.utf8)
        for status in [409, 500] {
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!
            do {
                let _: SottoSpeakingUploadResponse = try client.decodeResponse(data, response: response, acceptedStatuses: [201])
                XCTFail("Expected rejection")
            } catch let error as SottoAPIError {
                if status == 409 {
                    guard case .classRecordingRejected = error else { return XCTFail("Expected definite rejection") }
                } else {
                    guard case .http(500, _) = error else { return XCTFail("Expected unknown server failure") }
                }
            }
        }
    }

    @MainActor
    func testRemovingASessionDiscardsQueuedProgressWithoutASaveAfterDismissal() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"saved":true,"progressRevision":2}"#) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/classes/removed", revision: 1)
        await progress.suspend()
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Kept until deletion succeeds"])
        progress.discard()
        await progress.flush()
        progress.update(answers: ["g0": 1], writingDrafts: [:])
        await progress.flush()
        XCTAssertTrue(server.requests.isEmpty)
        XCTAssertNil(progress.errorMessage)
    }

    @MainActor
    func testFailedRemovalCanResumeTheSamePendingAnswersAndDrafts() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"saved":true,"progressRevision":2}"#) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/classes/kept", revision: 0)
        progress.configure(client: client, path: "/api/v1/classes/kept", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        await progress.suspend()
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Preserved draft"])
        progress.resume()
        await progress.flush()
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.contains("Preserved draft"))
        XCTAssertEqual(progress.answers, ["g0": 2])
        XCTAssertNil(progress.errorMessage)
    }

    @MainActor
    func testConflictRecoveryPreservesLocalEditsUntilTheLearnerConfirms() async throws {
        let fixture = ProgressConflictFixture()
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/practice/saved", revision: 1)
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Local draft"])
        await progress.flush()
        XCTAssertNotNil(progress.errorMessage)
        XCTAssertEqual(fixture.answers, ["g0": 1])
        XCTAssertEqual(progress.answers, ["g0": 2])
        try await progress.prepareReconciliation()
        XCTAssertEqual(fixture.answers, ["g0": 1], "Reading the latest revision does not overwrite remote work.")
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertNil(progress.errorMessage)
        XCTAssertEqual(fixture.answers, ["g0": 2])
        XCTAssertEqual(fixture.drafts, ["w0": "Local draft"])
    }

    @MainActor
    func testChoosingServerDraftDiscardsTheConflictingQueuedSave() async throws {
        let fixture = ProgressConflictFixture()
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "practice-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/practice/saved", revision: 1)
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Local draft"])
        await progress.flush()
        XCTAssertNotNil(progress.errorMessage)
        await progress.suspend()
        progress.replacePendingWithServerRevision(2)
        await progress.flush()
        XCTAssertNil(progress.errorMessage)
        XCTAssertEqual(fixture.answers, ["g0": 1])
    }

    @MainActor
    func testClassRecoveryChecksMaterialAndSavesOnlyAfterConfirmation() async throws {
        let fixture = ClassProgressConflictFixture()
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/classes/saved", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Local draft"])
        await progress.flush()
        XCTAssertNotNil(progress.errorMessage)
        try await progress.prepareReconciliation()
        XCTAssertEqual(fixture.answers, ["g0": 1])
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertNil(progress.errorMessage)
        XCTAssertEqual(fixture.answers, ["g0": 2])
        XCTAssertTrue(server.requests.contains { $0.hasPrefix("GET /api/v1/classes/saved/progress-recovery ") })
        XCTAssertTrue(server.requests.contains { $0.contains("\"expectedAttempt\":1") && $0.contains(String(repeating: "a", count: 64)) })
    }

    @MainActor
    func testClassRecoveryKeepsEditsWhenMaterialChanged() async throws {
        let fixture = ClassProgressConflictFixture(material: String(repeating: "b", count: 64))
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/classes/saved", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Local draft"])
        await progress.flush()
        do { try await progress.prepareReconciliation(); XCTFail("Changed material was accepted") }
        catch { XCTAssertTrue(error.localizedDescription.contains("changed")) }
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertEqual(progress.answers, ["g0": 2])
        XCTAssertEqual(fixture.answers, ["g0": 1])
    }

    @MainActor
    func testClassRecoveryDoesNotConfirmAfterLearnerOrLocalEditsChange() async throws {
        let fixture = ClassProgressConflictFixture()
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        var current = true
        progress.configure(client: client, path: "/api/v1/classes/saved", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64), isCurrent: { current })
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "First draft"])
        await progress.flush()
        try await progress.prepareReconciliation()
        progress.update(answers: ["g0": 3], writingDrafts: ["w0": "New draft"])
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertEqual(fixture.answers, ["g0": 1])
        try await progress.prepareReconciliation()
        current = false
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertEqual(progress.answers, ["g0": 3])
        XCTAssertEqual(fixture.answers, ["g0": 1])
    }

    @MainActor
    func testClassRecoveryRetainsPendingEditsAcrossCredentialRotation() async throws {
        let fixture = ClassProgressConflictFixture()
        let server = try LocalHTTPServer { request in fixture.respond(request) }
        try await server.start()
        defer { server.stop() }
        let oldClient = SottoAPIClient(serverURL: server.url, apiKey: "old-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let newClient = SottoAPIClient(serverURL: server.url, apiKey: "new-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: oldClient, path: "/api/v1/classes/saved", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        await progress.suspend()
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Retained draft"])
        progress.configure(client: newClient, path: "/api/v1/classes/saved", revision: 2,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        progress.resume()
        await progress.flush()
        XCTAssertEqual(fixture.answers, ["g0": 1])
        XCTAssertNotNil(progress.errorMessage)
        try await progress.prepareReconciliation()
        progress.confirmReconciliation()
        await progress.flush()
        XCTAssertEqual(fixture.answers, ["g0": 2])
        XCTAssertTrue(server.requests.allSatisfy { $0.lowercased().contains("authorization: bearer new-secret") })
    }

    @MainActor
    func testCleanClassSessionBindsMaterialAfterServerUpgrade() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"saved":true,"progressRevision":2}"#) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: client, path: "/api/v1/classes/saved", revision: 0, attempt: 1)
        progress.configure(client: client, path: "/api/v1/classes/saved", revision: 1,
            attempt: 1, materialRevision: String(repeating: "a", count: 64))
        progress.update(answers: ["g0": 2], writingDrafts: [:])
        await progress.flush()
        XCTAssertNil(progress.errorMessage)
        XCTAssertTrue(server.requests.contains { $0.contains("\"expectedAttempt\":1") })
    }

    func testSpeakingRecoverySendsExactRecordingAndExplicitAcknowledgment() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"acknowledged":true}"#) }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        try await client.acknowledgeClassSpeakingRecovery(classId: "class", promptId: "prompt", recordingId: "recording")
        let request = try XCTUnwrap(server.requests.first)
        XCTAssertTrue(request.hasPrefix("POST /api/v1/classes/class/speaking/prompt/recovery "))
        XCTAssertTrue(request.lowercased().contains("authorization: bearer secret"))
        XCTAssertTrue(request.contains("\"recordingId\":\"recording\""))
        XCTAssertTrue(request.contains("\"acknowledgePossibleCharges\":true"))
    }

    @MainActor
    func testPracticeCredentialRotationKeepsUnverifiedPendingEditsOnScreen() async throws {
        let server = try LocalHTTPServer { _ in .json(#"{"saved":true,"progressRevision":2}"#) }
        try await server.start()
        defer { server.stop() }
        let oldClient = SottoAPIClient(serverURL: server.url, apiKey: "old-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let newClient = SottoAPIClient(serverURL: server.url, apiKey: "new-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        let progress = LearningProgressStore()
        progress.configure(client: oldClient, path: "/api/v1/practice/saved", revision: 1)
        await progress.suspend()
        progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Retained draft"])
        progress.configure(client: newClient, path: "/api/v1/practice/saved", revision: 1)
        progress.resume()
        await progress.flush()
        XCTAssertEqual(progress.answers, ["g0": 2])
        XCTAssertTrue(progress.errorMessage?.contains("copy") == true)
        XCTAssertTrue(progress.recoverableText?.contains("Retained draft") == true)
        XCTAssertTrue(progress.recoverableText?.contains("Question g0: option 3") == true)
        XCTAssertTrue(server.requests.isEmpty)
    }

    @MainActor
    func testConfirmedPracticeReloadReopensSavedWork() async throws {
        let saved = #"{"status":"ready_writing","sessionId":"saved","courseId":"course","prompts":[{"id":"w0","task":"Write a greeting"}],"progressRevision":2}"#
        let server = try LocalHTTPServer { request in
            request.hasPrefix("GET ") ? .json(saved) : .json(#"{"saved":true,"progressRevision":3}"#)
        }
        try await server.start()
        defer { server.stop() }
        let profile = SottoProfile(id: "learner", name: "Learner", avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
        let model = SottoAppModel(credentials: SottoCredentials(serverURL: server.url, apiKey: "new-secret", user: nil, selectedProfile: profile), session: URLSession(configuration: .ephemeral))
        let initial = try JSONDecoder().decode(SottoPracticeStart.self, from: Data(saved.utf8))
        model.practiceStart = initial
        let oldState = model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 1)
        let speaking = NativeSpeakingState()
        oldState.speaking["prompt"] = speaking
        await oldState.progress.suspend()
        oldState.progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Copied draft"])
        try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: oldState.progress)
        let replacement = model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 2)
        XCTAssertFalse(replacement === oldState)
        XCTAssertTrue(replacement.speaking["prompt"] === speaking)
        XCTAssertEqual(model.practiceStart?.progressRevision, 2)
        await oldState.progress.flush()
        XCTAssertEqual(server.requests.filter { $0.hasPrefix("PATCH ") }.count, 0)
        replacement.progress.update(answers: ["g0": 1], writingDrafts: [:])
        await replacement.progress.flush()
        XCTAssertTrue(server.requests.contains { $0.hasPrefix("PATCH /api/v1/practice/saved ") })
    }

    @MainActor
    func testPracticeReloadRejectsWrongSessionAndIncompleteResponse() async throws {
        let saved = #"{"status":"ready_writing","sessionId":"saved","courseId":"course","prompts":[{"id":"w0","task":"Write a greeting"}],"progressRevision":1}"#
        let server = try LocalHTTPServer { _ in .json(#"{"status":"ready_writing","sessionId":"saved","courseId":"course","prompts":[],"progressRevision":2}"#) }
        try await server.start()
        defer { server.stop() }
        let profile = SottoProfile(id: "learner", name: "Learner", avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
        let model = SottoAppModel(credentials: SottoCredentials(serverURL: server.url, apiKey: "secret", user: nil, selectedProfile: profile), session: URLSession(configuration: .ephemeral))
        model.practiceStart = try JSONDecoder().decode(SottoPracticeStart.self, from: Data(saved.utf8))
        let state = model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 1)
        let other = model.learningSessionState(path: "/api/v1/practice/other", attempt: 1, revision: 1)
        await state.progress.suspend()
        state.progress.update(answers: [:], writingDrafts: ["w0": "Still here"])
        do { try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: other.progress); XCTFail("Wrong session accepted") }
        catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        do { try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: state.progress); XCTFail("Empty response accepted") }
        catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        XCTAssertTrue(model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 1) === state)
        XCTAssertTrue(model.learningSessionState(path: "/api/v1/practice/other", attempt: 1, revision: 1) === other)
        XCTAssertTrue(state.progress.recoverableText?.contains("Still here") == true)
        let speaking = NativeSpeakingState()
        speaking.uploadUnknown = true
        state.speaking["prompt"] = speaking
        let requestCount = server.requests.count
        do { try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: state.progress); XCTFail("Speaking work was discarded") }
        catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        XCTAssertEqual(server.requests.count, requestCount)
        XCTAssertTrue(state.speaking["prompt"] === speaking)
        speaking.uploadUnknown = false
        speaking.recordingActive = true
        do { try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: state.progress); XCTFail("Active recording was discarded") }
        catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        XCTAssertEqual(server.requests.count, requestCount)
    }

    @MainActor
    func testFailedPracticeReloadKeepsLocalEditsAndSession() async throws {
        let saved = #"{"status":"ready_writing","sessionId":"saved","courseId":"course","prompts":[],"progressRevision":1}"#
        let server = try LocalHTTPServer { _ in .init(status: 404, headers: [:], body: #"{"error":"Not found"}"#) }
        try await server.start()
        defer { server.stop() }
        let profile = SottoProfile(id: "learner", name: "Learner", avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
        let model = SottoAppModel(credentials: SottoCredentials(serverURL: server.url, apiKey: "new-secret", user: nil, selectedProfile: profile), session: URLSession(configuration: .ephemeral))
        model.practiceStart = try JSONDecoder().decode(SottoPracticeStart.self, from: Data(saved.utf8))
        let state = model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 1)
        await state.progress.suspend()
        state.progress.update(answers: ["g0": 2], writingDrafts: ["w0": "Still here"])
        do { try await model.reloadPracticeDiscardingLocalEdits(sessionId: "saved", progress: state.progress); XCTFail("Missing session was accepted") }
        catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        XCTAssertTrue(model.learningSessionState(path: "/api/v1/practice/saved", attempt: 1, revision: 1) === state)
        XCTAssertTrue(state.progress.recoverableText?.contains("Still here") == true)
        await state.progress.flush()
        XCTAssertFalse(server.requests.contains { $0.hasPrefix("PATCH ") })
    }
    func test307DoesNotForwardHouseholdPasswordToAnotherOrigin() async throws {
        try await rejectRedirect(status: 307)
    }

    func test308DoesNotForwardPairingTokenToAnotherOrigin() async throws {
        try await rejectRedirect(status: 308)
    }

    private func rejectRedirect(status: Int) async throws {
        let destination = try LocalHTTPServer { _ in .json(#"{"sessionId":"leaked"}"#) }
        try await destination.start()
        defer { destination.stop() }
        let redirectURL = destination.url.appendingPathComponent("capture")
        let origin = try LocalHTTPServer { _ in
            .init(status: status, headers: ["Location": redirectURL.absoluteString], body: "")
        }
        try await origin.start()
        defer { origin.stop() }
        let client = SottoAPIClient(serverURL: origin.url, apiKey: nil, session: URLSession(configuration: .ephemeral))
        do {
            if status == 307 { try await client.enterHousehold(password: "private-password") }
            else { _ = try await client.redeemPairingToken("private-token") }
            XCTFail("Cross-origin redirects must fail before sending their private body.")
        } catch { XCTAssertTrue(error.localizedDescription.contains(String(status)), error.localizedDescription) }
        XCTAssertTrue(origin.requests.first?.contains(status == 307 ? "private-password" : "private-token") == true)
        XCTAssertTrue(destination.requests.isEmpty, "The redirected server must receive neither headers nor body.")
    }

    func testHouseholdCookieSurvivesSameOriginRedirectButBearerRequestsExcludeIt() async throws {
        let server = try LocalHTTPServer { request in
            let path = request.components(separatedBy: " ").dropFirst().first ?? ""
            if path == "/api/v1/access/household" {
                return .init(status: 200, headers: ["Set-Cookie": "household=private; Path=/; HttpOnly"], body: #"{"sessionId":"session"}"#)
            }
            if path == "/api/v1/profiles" {
                return .init(status: 307, headers: ["Location": "/profiles-final"], body: "")
            }
            return .json(#"{"profiles":[]}"#)
        }
        try await server.start()
        defer { server.stop() }
        let session = URLSession(configuration: .ephemeral)
        let household = SottoAPIClient(serverURL: server.url, apiKey: nil, session: session)
        try await household.enterHousehold(password: "password")
        _ = try await household.listProfiles()
        let bearer = SottoAPIClient(serverURL: server.url, apiKey: "private-bearer", profileId: "learner", session: session)
        _ = try await bearer.listProfiles()
        let requests = server.requests
        XCTAssertEqual(requests.count, 5)
        guard requests.count == 5 else { return }
        for request in requests[1...2] {
            XCTAssertTrue(request.lowercased().contains("cookie: household=private"), request)
            XCTAssertFalse(request.lowercased().contains("authorization:"), request)
        }
        for request in requests[3...4] {
            XCTAssertFalse(request.lowercased().contains("cookie:"), request)
            XCTAssertTrue(request.lowercased().contains("authorization: bearer private-bearer"), request)
            XCTAssertTrue(request.lowercased().contains("x-sotto-profile-id: learner"), request)
        }
    }
}


private final class ClassProgressConflictFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var revision = 2
    private var savedAnswers = ["g0": 1]
    private let material: String
    var answers: [String: Int] { lock.withLock { savedAnswers } }
    init(material: String = String(repeating: "a", count: 64)) { self.material = material }

    func respond(_ request: String) -> LocalHTTPServer.Response {
        lock.withLock {
            if request.hasPrefix("GET ") {
                return .json("{\"classId\":\"saved\",\"status\":\"AVAILABLE\",\"attempt\":1,\"progressRevision\":\(revision),\"taskMaterialRevision\":\"\(material)\"}")
            }
            let body = request.components(separatedBy: "\r\n\r\n").last ?? ""
            let payload = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]
            guard payload?["expectedRevision"] as? Int == revision,
                  payload?["expectedAttempt"] as? Int == 1,
                  payload?["taskMaterialRevision"] as? String == material else {
                return .init(status: 409, headers: [:], body: #"{"error":"Progress changed."}"#)
            }
            savedAnswers = payload?["answers"] as? [String: Int] ?? savedAnswers
            revision += 1
            return .json("{\"saved\":true,\"progressRevision\":\(revision)}")
        }
    }
}

private final class ProgressConflictFixture: @unchecked Sendable {
    private let lock = NSLock()
    private var revision = 2
    private var savedAnswers = ["g0": 1]
    private var savedDrafts = ["w0": "Remote draft"]
    var answers: [String: Int] { lock.withLock { savedAnswers } }
    var drafts: [String: String] { lock.withLock { savedDrafts } }

    func respond(_ request: String) -> LocalHTTPServer.Response {
        lock.withLock {
            if request.hasPrefix("GET ") {
                return .json("{\"status\":\"ready_writing\",\"sessionId\":\"saved\",\"prompts\":[],\"progressRevision\":\(revision)}")
            }
            let body = request.components(separatedBy: "\r\n\r\n").last ?? ""
            let payload = (try? JSONSerialization.jsonObject(with: Data(body.utf8))) as? [String: Any]
            guard payload?["expectedRevision"] as? Int == revision else {
                return .init(status: 409, headers: [:], body: #"{"error":"Progress changed in another device."}"#)
            }
            savedAnswers = payload?["answers"] as? [String: Int] ?? savedAnswers
            savedDrafts = payload?["writingDrafts"] as? [String: String] ?? savedDrafts
            revision += 1
            return .json("{\"saved\":true,\"progressRevision\":\(revision)}")
        }
    }
}
