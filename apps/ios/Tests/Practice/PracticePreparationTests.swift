import Combine
import XCTest

@testable import Sotto

final class PracticePreparationTests: XCTestCase {
    @MainActor
    func testVocabularyKindSurvivesAdmissionPollingAndCancellation() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.startPractice(courseId: "course", kind: "VOCAB")
        let sessionId = try XCTUnwrap(model.practiceStart?.sessionId)
        XCTAssertEqual(model.practiceStart?.title, "Vocabulary practice")
        XCTAssertTrue(model.practiceStart?.isPreparing == true)

        try await model.refreshPractice(sessionId: sessionId)
        XCTAssertEqual(model.practiceStart?.title, "Vocabulary practice")

        try await model.practiceGenerationAction(sessionId: sessionId, action: "cancel")
        XCTAssertEqual(model.practiceStart?.preparationStatus, "CANCELLED")
        XCTAssertEqual(model.practiceStart?.title, "Vocabulary practice")
        XCTAssertFalse(model.practiceStart?.isPreparing == true)
        XCTAssertNil(model.loadingOperation)
        XCTAssertFalse(model.isLoading)
    }

    @MainActor
    func testReopeningCancelledVocabularyUsesTheDashboardKindAndOutcome() async throws {
        let model = model()
        let host = try XCTUnwrap(model.credentials?.serverURL.host)
        await PracticePreparationServer.shared.set("CANCELLED", host: host)
        await model.loadCourses(showLoading: false)
        await model.loadPracticeOverview(courseId: "course")
        await model.resumePractice(sessionId: PracticePreparationServer.sessionId)
        XCTAssertEqual(model.practiceStart?.title, "Vocabulary practice")
        XCTAssertEqual(model.practiceStart?.preparationStatus, "CANCELLED")
        XCTAssertTrue(model.practiceOverview?.unfinished.isEmpty == true)
        XCTAssertEqual(model.practiceOverview?.unsuccessful.first?.statusLabel, "Cancelled")
    }

    @MainActor
    func testClosingPreparationRefreshesTheDashboardToItsCurrentOutcome() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.loadPracticeOverview(courseId: "course")
        await model.resumePractice(sessionId: PracticePreparationServer.sessionId)
        XCTAssertEqual(model.practiceOverview?.preparing.first?.kind, "VOCAB")
        let host = try XCTUnwrap(model.credentials?.serverURL.host)
        await PracticePreparationServer.shared.set("FAILED", host: host)
        let refreshed = expectation(description: "Dashboard shows the failed attempt")
        let observation = model.$practiceOverview.sink { overview in
            if overview?.unsuccessful.first?.status == "FAILED" { refreshed.fulfill() }
        }
        model.closePractice()
        await fulfillment(of: [refreshed], timeout: 2)
        observation.cancel()
        XCTAssertNil(model.practiceStart)
        XCTAssertTrue(model.practiceOverview?.unfinished.isEmpty == true)
        XCTAssertTrue(model.practiceOverview?.preparing.isEmpty == true)
    }

    @MainActor
    func testUnavailablePollReplacesTheOpenPreparationInsteadOfLeavingItSpinning() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.startPractice(courseId: "course", kind: "VOCAB")
        let sessionId = try XCTUnwrap(model.practiceStart?.sessionId)
        let host = try XCTUnwrap(model.credentials?.serverURL.host)
        await PracticePreparationServer.shared.set("UNAVAILABLE", host: host)
        try await model.refreshPractice(sessionId: sessionId)
        XCTAssertEqual(model.practiceStart?.sessionId, sessionId)
        XCTAssertEqual(model.practiceStart?.status, "unavailable")
        XCTAssertEqual(model.practiceStart?.title, "Vocabulary practice")
        XCTAssertFalse(model.practiceStart?.isPreparing == true)
        await PracticePreparationServer.shared.set("RUNNING", host: host)
        await model.startPractice(courseId: "course", kind: "VOCAB")
        XCTAssertNotEqual(model.practiceStart?.sessionId, sessionId,
            "Settled unavailable attempts must not trap later practice in the old request.")
        XCTAssertTrue(model.practiceStart?.isPreparing == true)
    }

    @MainActor
    func testForegroundRefreshReplacesPreparingWithTheFailedAttempt() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.loadPracticeOverview(courseId: "course")
        XCTAssertEqual(model.practiceOverview?.preparing.first?.kind, "VOCAB")
        let host = try XCTUnwrap(model.credentials?.serverURL.host)
        await PracticePreparationServer.shared.set("FAILED", host: host)
        await model.refreshPreparingPracticeOverview()
        XCTAssertTrue(model.practiceOverview?.preparing.isEmpty == true)
        XCTAssertTrue(model.practiceOverview?.unfinished.isEmpty == true)
        XCTAssertEqual(model.practiceOverview?.unsuccessful.first?.statusLabel, "Generation failed")
    }

    @MainActor
    private func model() -> SottoAppModel {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PracticePreparationHTTP.self]
        return SottoAppModel(credentials: SottoCredentials(
            serverURL: URL(string: "https://\(UUID().uuidString.lowercased()).example")!,
            apiKey: "synthetic-test-key", user: nil, selectedProfile: SottoProfile(
                id: "learner", name: "Learner", avatarUrl: "", isOwner: true,
                role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)),
            session: URLSession(configuration: configuration))
    }
}

private actor PracticePreparationServer {
    static let shared = PracticePreparationServer()
    static let sessionId = "a5ae2933-9220-45ad-9400-8ae2a35a5cbe"
    private var states: [String: String] = [:]
    private var sessions: [String: String] = [:]

    func set(_ state: String, host: String) { states[host] = state }

    func respond(_ request: URLRequest) -> (Int, String) {
        let host = request.url!.host!
        let path = request.url!.path
        if path == "/api/v1/courses/course/practice", request.httpMethod == "POST" {
            var body = request.httpBody ?? Data()
            if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    body.append(contentsOf: buffer.prefix(count))
                }
            }
            let admission = try? JSONDecoder().decode(Admission.self, from: body)
            XCTAssertEqual(admission?.kind, "VOCAB")
            sessions[host] = admission?.requestId
        }
        let sessionId = sessions[host] ?? Self.sessionId
        if path == "/api/v1/courses" {
            return (200, #"{"courses":[{"id":"course","nativeLang":"en","targetLang":"de","currentLevel":"A2","startLevel":"A2","classes":[]}]}"#)
        }
        if path.hasSuffix("/generation"), request.httpMethod == "POST" { states[host] = "CANCELLED" }
        let state = states[host] ?? "RUNNING"
        if path == "/api/v1/courses/course/practice", request.httpMethod == "GET" {
            let status = ["FAILED", "CANCELLED"].contains(state) ? state : "GENERATING"
            return (200, """
                {"due":{"vocab":0,"grammar":0},"totalVocab":12,"recent":[
                {"id":"\(sessionId)","kind":"VOCAB","status":"\(status)","completedAt":null}]}
                """)
        }
        if state == "UNAVAILABLE" {
            return (200, #"{"status":"unavailable","reason":"nothing_due"}"#)
        }
        return (request.httpMethod == "POST" ? 202 : 200, """
            {"status":"preparing","sessionId":"\(sessionId)","preparationStatus":"\(state)","message":"Server state: \(state)","canRecover":false}
            """)
    }

    private struct Admission: Decodable {
        let kind: String
        let requestId: String
    }
}

private final class PracticePreparationHTTP: URLProtocol {
    private var work: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        work = Task {
            let (status, body) = await PracticePreparationServer.shared.respond(request)
            guard !Task.isCancelled else { return }
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { work?.cancel() }
}
