import Network
import XCTest

@testable import Sotto

final class APITransportPrivacyTests: XCTestCase {
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

    func testClassRegenerationAccepts202AndPinsTheObservedAttempt() async throws {
        let server = try LocalHTTPServer { _ in
            .init(status: 202, headers: [:], body: #"{"started":true,"status":"GENERATING","scope":"class","operationId":"9ad1cf1c-ec3a-4605-8a85-d0a5b95160ac","courseId":"course"}"#)
        }
        try await server.start()
        defer { server.stop() }
        let client = SottoAPIClient(serverURL: server.url, apiKey: "class-secret", profileId: "learner", session: URLSession(configuration: .ephemeral))
        try await client.startClassRegeneration(classId: "class-saved", expectedAttempt: 4)
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

/// A real loopback HTTP boundary exercises Foundation's redirect and cookie
/// handling, which URLProtocol fixtures do not reproduce.
private final class LocalHTTPServer: @unchecked Sendable {
    struct Response {
        let status: Int
        let headers: [String: String]
        let body: String
        static func json(_ body: String) -> Self { .init(status: 200, headers: [:], body: body) }
    }
    private let listener: NWListener
    private let queue = DispatchQueue(label: "SottoTransportPrivacyTest")
    private let lock = NSLock()
    private var received: [String] = []
    private let respond: @Sendable (String) -> Response
    var requests: [String] { lock.withLock { received } }
    var url: URL { URL(string: "http://127.0.0.1:\(listener.port!.rawValue)")! }

    init(respond: @escaping @Sendable (String) -> Response) throws {
        listener = try NWListener(using: .tcp, on: .any)
        self.respond = respond
    }

    func start() async throws {
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, data: Data())
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume()
                case .failed(let error):
                    self?.listener.stateUpdateHandler = nil
                    continuation.resume(throwing: error)
                default: break
                }
            }
            listener.start(queue: queue)
        }
    }

    func stop() { listener.cancel() }

    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] chunk, _, done, error in
            guard let self else { connection.cancel(); return }
            var buffer = data
            if let chunk { buffer.append(chunk) }
            let text = String(decoding: buffer, as: UTF8.self)
            if let headerEnd = text.range(of: "\r\n\r\n") {
                let headers = String(text[..<headerEnd.lowerBound])
                let length = headers.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
                    .flatMap { Int($0.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                if text[headerEnd.upperBound...].utf8.count >= length {
                    self.lock.withLock { self.received.append(text) }
                    let response = self.respond(text)
                    var headers = response.headers
                    if headers["Content-Type"] == nil { headers["Content-Type"] = "application/json" }
                    let fields = headers.map { "\($0.key): \($0.value)\r\n" }.joined()
                    let wire = "HTTP/1.1 \(response.status) Response\r\nContent-Length: \(response.body.utf8.count)\r\nConnection: close\r\n\(fields)\r\n\(response.body)"
                    connection.send(content: Data(wire.utf8), completion: .contentProcessed { _ in connection.cancel() })
                    return
                }
            }
            if done || error != nil { connection.cancel() }
            else { self.receive(connection, data: buffer) }
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
