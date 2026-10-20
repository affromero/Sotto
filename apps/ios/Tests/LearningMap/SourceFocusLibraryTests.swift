import Foundation
import XCTest
@testable import Sotto

@MainActor
final class SourceFocusLibraryTests: XCTestCase {
    func testAnalysisPaginationPreservesExactAfterCursorAndReachesTheNextOwnedPage() async throws {
        let model = try await makeModel(mode: .paginated)
        let first = try await model.savedSourceAnalyses(courseId: "course", cursor: nil)
        XCTAssertEqual(first.items.count, 20)
        let cursor = try XCTUnwrap(first.nextCursor)
        XCTAssertEqual(cursor, "saved+analysis/cursor?20")
        let second = try await model.savedSourceAnalyses(courseId: "course", cursor: cursor)
        XCTAssertEqual(second.items.count, 1)
        XCTAssertEqual(second.items.first?.sourceNames, ["Source 21.pdf"])
        XCTAssertFalse(first.items.contains { $0.analysisId == second.items.first?.analysisId })
        XCTAssertNil(second.nextCursor)
    }
    func testOwnedFocusPreservesOccurrenceIdentityExactCitationsAndNoCanonicalSelection() async throws {
        let model = try await makeModel()
        let list = try await model.savedSourceAnalyses(courseId: "course", cursor: nil)
        let analysis = try XCTUnwrap(list.items.first)
        let focuses = try await model.savedSourceFocuses(courseId: "course", target: "de", analysis: analysis, afterOrder: nil)
        let focus = try XCTUnwrap(focuses.focuses.first)
        let detail = try await model.savedSourceFocusDetail(analysis: analysis, focus: focus)
        XCTAssertEqual(focus.id, String(repeating: "f", count: 64))
        XCTAssertEqual(detail.focus.title, "Changing an appointment")
        XCTAssertEqual(detail.focus.citations.first?.quote, "\u{FEFF}Heute\u{0000} geht es später.")
        XCTAssertEqual(Data(try XCTUnwrap(detail.focus.citations.first?.quote).utf8), Data("\u{FEFF}Heute\u{0000} geht es später.".utf8))
        XCTAssertTrue(detail.focus.exposureOnly)
        XCTAssertTrue(detail.focus.privateExtension)
        let selection = SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: .a1, materialFocusId: focus.id)
        XCTAssertTrue(selection.nodeIds.isEmpty)
        XCTAssertEqual(selection.materialFocusId, focus.id)
    }

    func testForeignCourseOrStaleAnalysisCannotProduceAPracticeFocus() async throws {
        for mode in [SourceFocusServer.Mode.foreign, .stale] {
            let model = try await makeModel(mode: mode)
            let list = try await model.savedSourceAnalyses(courseId: "course", cursor: nil)
            do {
                _ = try await model.savedSourceFocuses(courseId: "course", target: "de", analysis: XCTUnwrap(list.items.first), afterOrder: nil)
                XCTFail("Expected foreign or stale source rejection")
            } catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        }
    }

    private func makeModel(mode: SourceFocusServer.Mode = .normal) async throws -> SottoAppModel {
        let host = "library-\(UUID().uuidString.lowercased()).example"
        await SourceFocusServer.shared.register(host, mode: mode)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [SourceFocusHTTP.self]
        return SottoAppModel(credentials: SottoCredentials(serverURL: URL(string: "https://\(host)")!, apiKey: "library-key", user: nil,
            selectedProfile: SottoProfile(id: "learner", name: "Learner", avatarUrl: "", isOwner: false, role: "USER", courseCount: nil, primaryCourse: nil, isActive: nil)), session: URLSession(configuration: config))
    }
}

private actor SourceFocusServer {
    enum Mode: Sendable { case normal, foreign, stale, paginated }
    static let shared = SourceFocusServer()
    private let analysisId = "00000000-0000-4000-8000-000000000001"
    private var modes: [String: Mode] = [:]
    func register(_ host: String, mode: Mode) { modes[host] = mode }
    func respond(_ request: URLRequest) throws -> Data {
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer library-key",
              request.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "learner", request.httpMethod == "GET" else { throw URLError(.userAuthenticationRequired) }
        let mode = modes[request.url!.host!]!
        let identity: [String: Any] = ["analysisId": analysisId, "analysisRevision": 3, "resultDigest": String(repeating: "a", count: 64), "status": "COMPLETE"]
        if request.url!.path.hasPrefix("/api/v1/courses/") {
            if mode == .paginated {
                let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
                let after = query.first { $0.name == "after" }?.value
                guard query.isEmpty || query.count == 1 && after == "saved+analysis/cursor?20" else { throw URLError(.badURL) }
                let indices = after == nil ? Array(1...20) : [21]
                let items: [[String: Any]] = indices.map { index in
                    identity.merging(["analysisId": String(format: "00000000-0000-4000-8000-%012d", index),
                                      "sourceNames": ["Source \(index).pdf"], "focusCount": 1]) { _, value in value }
                }
                return try JSONSerialization.data(withJSONObject: ["courseId": "course", "items": items,
                    "nextCursor": after == nil ? "saved+analysis/cursor?20" as Any : NSNull()])
            }
            let item = identity.merging(["sourceNames": ["Grammar original.pdf"], "focusCount": 1]) { _, value in value }
            return try JSONSerialization.data(withJSONObject: ["courseId": "course", "items": [item], "nextCursor": NSNull()])
        }
        if request.url!.path.contains("/focuses/") {
            return try JSONSerialization.data(withJSONObject: identity.merging(["focusDigest": String(repeating: "b", count: 64), "focus": ["id": String(repeating: "e", count: 64), "title": "Changing an appointment", "privateExtension": true, "uncertainSource": false, "exposureOnly": true, "citations": [["streamId": "stream", "pageNumber": 1, "origin": "EMBEDDED_TEXT", "codePointStart": 0, "codePointEnd": 24, "quote": "\u{FEFF}Heute\u{0000} geht es später."]]]]) { _, value in value })
        }
        return try JSONSerialization.data(withJSONObject: identity.merging(["courseId": mode == .foreign ? "foreign" : "course", "target": "de", "stale": mode == .stale,
            "focuses": [["id": String(repeating: "f", count: 64), "title": "Changing an appointment", "kind": "SITUATION", "level": "A1", "order": 0, "focusDigest": String(repeating: "b", count: 64), "objectiveIds": ["de.a1.situations.appointment"]]], "nextCursor": NSNull()]) { _, value in value })
    }
}

private final class SourceFocusHTTP: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task {
            do {
                let data = try await SourceFocusServer.shared.respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}
