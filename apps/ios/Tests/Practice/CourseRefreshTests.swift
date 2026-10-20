import XCTest
import Combine

@testable import Sotto

final class CourseRefreshTests: XCTestCase {
    @MainActor
    func testPencilWorkbookOpensTheInteractiveClassWithoutRequiringAPDF() async {
        let model = model()
        await model.openWorkbook(for: "class-1", pencil: true)
        XCTAssertEqual(model.selectedClass?.id, "class-1")
        XCTAssertTrue(model.pencilWorkbook)
        XCTAssertNil(model.workbook)
        model.closeClass()
        XCTAssertFalse(model.pencilWorkbook)
    }

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
        let session = makeSession()
        let model = model(session: session)
        let credentials = model.credentials!
        let host = model.credentials!.serverURL.host!
        let arrival = expectation(description: "Course refresh reaches its held response")
        await CourseRefreshServer.shared.set("profile-refresh", host: host, arrival: arrival)
        addTeardownBlock {
            await CourseRefreshServer.shared.release(host: host)
            session.invalidateAndCancel()
        }
        let previous = Task { await model.loadCourses(showLoading: false) }
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await CourseRefreshServer.shared.release(host: host)
            previous.cancel()
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Course refresh did not arrive within five seconds.")
            return
        }
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
        let session = makeSession()
        let model = model(session: session)
        await model.loadCourses(showLoading: false)
        let host = model.credentials!.serverURL.host!
        let arrival = expectation(description: "Practice admission reaches its held response")
        await CourseRefreshServer.shared.set("practice-admission", host: host, arrival: arrival)
        addTeardownBlock {
            await CourseRefreshServer.shared.release(host: host)
            session.invalidateAndCancel()
        }
        let pending = Task { await model.startPractice(courseId: "course-1", kind: "FULL") }
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await CourseRefreshServer.shared.release(host: host)
            pending.cancel()
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Practice admission did not arrive within five seconds.")
            return
        }
        model.applyCourseRefresh([])
        await CourseRefreshServer.shared.release(host: host)
        await pending.value
        XCTAssertTrue(model.courses.isEmpty)
        XCTAssertNil(model.practiceStart)
        XCTAssertNil(model.practiceResult)
    }

    @MainActor
    func testFinalGenerationRefreshCannotRestoreADeletedCourseOrItsError() async throws {
        let session = makeSession()
        let model = model(session: session)
        await model.loadCourses(showLoading: false)
        let course = try XCTUnwrap(model.courses.first)
        let host = model.credentials!.serverURL.host!
        let arrival = expectation(description: "Completed generation reaches its final course refresh")
        await CourseRefreshServer.shared.set("final-generation", host: host, arrival: arrival)
        addTeardownBlock {
            await CourseRefreshServer.shared.release(host: host)
            session.invalidateAndCancel()
        }
        model.startClassGeneration(for: course)
        guard await XCTWaiter.fulfillment(of: [arrival], timeout: 5) == .completed else {
            await CourseRefreshServer.shared.release(host: host)
            model.applyCourseRefresh([])
            session.invalidateAndCancel()
            XCTFail("Final course refresh did not arrive within five seconds.")
            return
        }
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
    private func model(session: URLSession? = nil) -> SottoAppModel {
        SottoAppModel(credentials: SottoCredentials(
            serverURL: URL(string: "https://\(UUID().uuidString.lowercased()).example")!,
            apiKey: "test-key", user: nil, selectedProfile: profile("alice")),
            session: session ?? makeSession())
    }

    private func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CourseRefreshProtocol.self]
        return URLSession(configuration: configuration)
    }

    private func profile(_ id: String) -> SottoProfile {
        SottoProfile(id: id, name: id, avatarUrl: "/avatars/penguin.png", isOwner: true,
            role: "ADMIN", courseCount: nil, primaryCourse: nil, isActive: nil)
    }
}

private actor CourseRefreshServer {
    static let shared = CourseRefreshServer()
    private var modes: [String: String] = [:]
    private var arrivals: [String: XCTestExpectation] = [:]
    private var releases: [String: CheckedContinuation<Void, Never>] = [:]

    func set(_ mode: String, host: String, arrival: XCTestExpectation? = nil) {
        modes[host] = mode
        arrivals[host] = arrival
    }

    func release(host: String) {
        arrivals[host] = nil
        releases.removeValue(forKey: host)?.resume()
    }

    private func block(host: String) async {
        guard let arrival = arrivals.removeValue(forKey: host) else { return }
        await withCheckedContinuation { continuation in
            releases[host] = continuation
            arrival.fulfill()
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
            return (202, #"{"started":true,"operationId":"preparation"}"#)
        }
        if mode == "final-generation", request.url?.path.hasSuffix("/generation") == true {
            return (200, #"{"operationId":"preparation","operationStatus":"COMPLETED","status":"AVAILABLE","classId":"class-1","stage":"Ready","detail":"Ready","progress":1,"currentStep":6,"totalSteps":6,"sections":[]}"#)
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
