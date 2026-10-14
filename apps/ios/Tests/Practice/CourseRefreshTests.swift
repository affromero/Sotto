import XCTest
import Combine

@testable import Sotto

final class CourseRefreshTests: XCTestCase {
    @MainActor
    func testRefreshRemovesDeletedCourseAndItsOpenLearningSessions() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        XCTAssertEqual(model.courses.first?.id, "course-1")
        XCTAssertEqual(model.selectedClass?.id, "class-1")
        model.practiceStart = try JSONDecoder().decode(SottoPracticeStart.self,
            from: Data(#"{"status":"ready","sessionId":"practice-1"}"#.utf8))
        model.practiceCourses["practice-1"] = "course-1"
        await CourseRefreshServer.shared.set("empty", host: model.credentials!.serverURL.host!)
        await model.loadCourses(showLoading: false)
        XCTAssertTrue(model.courses.isEmpty)
        XCTAssertNil(model.selectedClass)
        XCTAssertNil(model.practiceStart)
        XCTAssertNil(model.courseRefreshError)
    }

    @MainActor
    func testRefreshKeepsCourseAndLevelWhenOnlyItsClassWasDeleted() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        await CourseRefreshServer.shared.set("reset", host: model.credentials!.serverURL.host!)
        await model.loadCourses(showLoading: false)
        XCTAssertEqual(model.courses.first?.id, "course-1")
        XCTAssertEqual(model.courses.first?.currentLevel, "A2")
        XCTAssertNil(model.courses.first?.activeClassId)
        XCTAssertTrue(model.courses.first?.classes.isEmpty == true)
        XCTAssertNil(model.selectedClass)
    }

    @MainActor
    func testFailedBackgroundRefreshPreservesCourseSessionAndExistingError() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        model.errorMessage = "Existing failure"
        model.isLoading = true
        await CourseRefreshServer.shared.set("failed", host: model.credentials!.serverURL.host!)
        await model.loadCourses(showLoading: false)
        XCTAssertEqual(model.courses.first?.id, "course-1")
        XCTAssertEqual(model.selectedClass?.id, "class-1")
        XCTAssertEqual(model.errorMessage, "Existing failure")
        XCTAssertNotNil(model.courseRefreshError)
        XCTAssertTrue(model.isLoading)
    }

    @MainActor
    func testOlderCourseSnapshotDoesNotCloseANewClassItNeverContained() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        guard let current = model.selectedClass else { return XCTFail("Expected the saved class.") }
        model.selectedClass = SottoClassDetail(id: "new-class", courseId: current.courseId,
            status: current.status, order: 10, passThreshold: current.passThreshold, sourceUrl: nil,
            sourceTitle: nil, lesson: nil, intro: nil, vocabulary: nil, submitted: true, sections: [])
        await CourseRefreshServer.shared.set("reset", host: model.credentials!.serverURL.host!)
        await model.loadCourses(showLoading: false)
        XCTAssertEqual(model.selectedClass?.id, "new-class")
    }

    @MainActor
    func testMissingClassRefreshesCourseInsteadOfLeavingAResumeAction() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        await CourseRefreshServer.shared.set("reset", host: model.credentials!.serverURL.host!)
        await model.openClass("class-1")
        XCTAssertNil(model.selectedClass)
        XCTAssertNil(model.courses.first?.activeClassId)
        XCTAssertEqual(model.courses.first?.currentLevel, "A2")
        XCTAssertTrue(model.errorMessage?.contains("removed") == true)
        XCTAssertFalse(model.isLoading)
    }

    @MainActor
    func testTemporaryClassFailurePreservesAnExistingSession() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        await model.openClass("class-1")
        await CourseRefreshServer.shared.set("failed", host: model.credentials!.serverURL.host!)
        await model.openClass("class-1")
        XCTAssertEqual(model.selectedClass?.id, "class-1")
        XCTAssertEqual(model.courses.first?.activeClassId, "class-1")
        XCTAssertTrue(model.errorMessage?.contains("unavailable") == true)
    }

    func testAPIKeepsNotFoundStatusAndServerExplanation() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CourseRefreshProtocol.self]
        let host = UUID().uuidString.lowercased() + ".example"
        await CourseRefreshServer.shared.set("reset", host: host)
        let client = SottoAPIClient(serverURL: URL(string: "https://" + host)!, apiKey: "test-key",
            profileId: "alice", session: URLSession(configuration: configuration))
        do {
            _ = try await client.fetchClass(classId: "class-1")
            XCTFail("A removed class must return its HTTP error.")
        } catch {
            guard case SottoAPIError.http(404, let message) = error else {
                return XCTFail("Expected a typed 404, received \(error)")
            }
            XCTAssertTrue(message.contains("not found"))
        }
    }

    @MainActor
    func testLateRefreshAfterClearingProfileDoesNotRestorePreviousCourses() async {
        let store = CredentialStore()
        let original = try? store.load()
        defer {
            if let original { try? store.save(original) }
            else { try? store.delete() }
        }
        let model = model()
        let credentials = model.credentials!
        let host = model.credentials!.serverURL.host!
        await CourseRefreshServer.shared.set("profile-refresh", host: host)
        let previous = Task { await model.loadCourses(showLoading: false) }
        await CourseRefreshServer.shared.waitForBlockedRequest(host: host)
        model.clearSelectedProfile()
        await CourseRefreshServer.shared.release(host: host)
        await previous.value
        XCTAssertTrue(model.isPaired)
        XCTAssertEqual(model.credentials?.serverURL, credentials.serverURL)
        XCTAssertEqual(model.credentials?.apiKey, credentials.apiKey)
        XCTAssertNil(model.activeProfile)
        XCTAssertTrue(model.courses.isEmpty)
        XCTAssertNil(model.courseRefreshError)
    }

    @MainActor
    func testPracticeAdmissionCannotReopenSessionsAfterTheirCourseWasRemoved() async {
        let model = model()
        await model.loadCourses(showLoading: false)
        let host = model.credentials!.serverURL.host!
        await CourseRefreshServer.shared.set("practice-admission", host: host)
        let pending = Task { await model.startPractice(courseId: "course-1", kind: "FULL") }
        await CourseRefreshServer.shared.waitForBlockedRequest(host: host)
        model.applyCourseRefresh([])
        await CourseRefreshServer.shared.release(host: host)
        await pending.value
        XCTAssertTrue(model.courses.isEmpty)
        XCTAssertNil(model.practiceStart)
        XCTAssertNil(model.practiceResult)
    }

    @MainActor
    func testFinalGenerationRefreshCannotRestoreADeletedCourseOrItsError() async throws {
        let model = model()
        await model.loadCourses(showLoading: false)
        let course = try XCTUnwrap(model.courses.first)
        let host = model.credentials!.serverURL.host!
        await CourseRefreshServer.shared.set("final-generation", host: host)
        model.startClassGeneration(for: course)
        await CourseRefreshServer.shared.waitForBlockedRequest(host: host)
        model.applyCourseRefresh([])
        let reintroduced = expectation(description: "Deleted course generation remains cleared")
        reintroduced.isInverted = true
        let observation = model.$classGenerationOperations.combineLatest(model.$classGenerationErrors)
            .sink { operations, errors in
                if operations[course.id] != nil || errors[course.id] != nil { reintroduced.fulfill() }
            }
        await CourseRefreshServer.shared.release(host: host)
        await fulfillment(of: [reintroduced], timeout: 0.2)
        observation.cancel()
        XCTAssertTrue(model.courses.isEmpty)
    }

    @MainActor
    private func model() -> SottoAppModel {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CourseRefreshProtocol.self]
        return SottoAppModel(credentials: SottoCredentials(
            serverURL: URL(string: "https://\(UUID().uuidString.lowercased()).example")!,
            apiKey: "test-key", user: nil, selectedProfile: profile("alice")),
            session: URLSession(configuration: configuration))
    }

    private func profile(_ id: String) -> SottoProfile {
        SottoProfile(id: id, name: id, avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
    }
}

private actor CourseRefreshServer {
    static let shared = CourseRefreshServer()
    private var modes: [String: String] = [:]
    private var blocked = Set<String>()
    private var started: [String: CheckedContinuation<Void, Never>] = [:]
    private var releases: [String: CheckedContinuation<Void, Never>] = [:]

    func set(_ mode: String, host: String) { modes[host] = mode }

    func waitForBlockedRequest(host: String) async {
        if blocked.contains(host) { return }
        await withCheckedContinuation { started[host] = $0 }
    }

    func release(host: String) { releases.removeValue(forKey: host)?.resume() }

    private func block(host: String) async {
        await withCheckedContinuation { continuation in
            releases[host] = continuation
            blocked.insert(host)
            started.removeValue(forKey: host)?.resume()
        }
    }

    func respond(_ request: URLRequest) async -> (Int, String) {
        let mode = modes[request.url!.host!] ?? "ready"
        let host = request.url!.host!
        if mode == "practice-admission", request.httpMethod == "POST" {
            await block(host: host)
            return (200, #"{"status":"ready","sessionId":"late-practice"}"#)
        }
        if mode == "final-generation", request.httpMethod == "POST" {
            return (202, #"{"started":true}"#)
        }
        if mode == "final-generation", request.url?.path.hasSuffix("/generation") == true {
            return (200, #"{"status":"AVAILABLE","classId":"class-1","stage":"Ready","detail":"Ready","progress":1,"currentStep":6,"totalSteps":6,"sections":[]}"#)
        }
        if mode == "failed" { return (503, #"{"error":"Server unavailable"}"#) }
        if request.url?.path == "/api/v1/courses" {
            if mode == "final-generation" || mode == "profile-refresh" { await block(host: host) }
            if mode == "empty" { return (200, #"{"courses":[]}"#) }
            let classes = mode == "reset" ? "[]" : #"[{"id":"class-1","order":9,"status":"SUBMITTED","attempt":1,"createdAt":"2026-09-29T10:00:00Z","lesson":{"title":"Past events","level":"A2"}}]"#
            let active = mode == "reset" ? "null" : #""class-1""#
            return (200, """
                {"courses":[{"id":"course-1","nativeLang":"en","targetLang":"de","currentLevel":"A2","startLevel":"A2","placementSource":"MANUAL","activeClassId":\(active),"classes":\(classes)}]}
                """)
        }
        if mode == "reset" || mode == "empty" { return (404, #"{"error":"Class not found"}"#) }
        return (200, #"{"id":"class-1","courseId":"course-1","status":"SUBMITTED","order":9,"passThreshold":0.8,"submitted":true,"sections":[]}"#)
    }
}

private final class CourseRefreshProtocol: URLProtocol {
    private var work: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertTrue(["GET", "POST"].contains(request.httpMethod ?? ""))
        if request.url?.path == "/api/v1/courses" {
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        }
        work = Task {
            let (status, body) = await CourseRefreshServer.shared.respond(request)
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
