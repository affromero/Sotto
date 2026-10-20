import Foundation
import XCTest

@testable import Sotto

final class PlacementTransportTests: XCTestCase {
    func testQueuedPlacementPollsItsSavedIdentityAndSubmitsTheExactReceipt() async throws {
        let fixture = try await client(mode: .queued)
        let requestId = UUID()
        let batch = try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: requestId, pollInterval: .zero)
        XCTAssertEqual(batch.status, "READY")
        let submissionId = UUID()
        let result = try await fixture.client.submitPlacement(batch: batch, requestId: submissionId,
            answers: batch.questions.map { SottoPlacementAnswer(id: $0.id, selectedIndex: 4) })
        XCTAssertEqual(result.level, "A2")
        XCTAssertEqual(result.assessedLevel, "B1")
        let requests = await PlacementTransportServer.shared.requests(host: fixture.host)
        let first = try JSONDecoder().decode(AdmittedPlacement.self, from: try XCTUnwrap(requests.first?.httpBody))
        XCTAssertEqual(requests.first?.url?.path, "/api/v1/placement/generate")
        XCTAssertEqual(requests.first?.httpMethod, "POST")
        XCTAssertEqual(first.requestId, requestId)
        let polls = requests.filter { $0.url?.query?.contains("placementSessionId=") == true }
        XCTAssertEqual(polls.count, 2)
        XCTAssertTrue(polls.allSatisfy { $0.url?.query == "placementSessionId=\(PlacementTransportServer.sessionId)" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer native-fixture" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "learner" })
        let body = try XCTUnwrap(requests.last?.httpBody)
        let submitted = try JSONDecoder().decode(SubmittedPlacement.self, from: body)
        XCTAssertEqual(submitted.requestId, submissionId)
        XCTAssertEqual(submitted.placementSessionId.uuidString.lowercased(), PlacementTransportServer.sessionId)
        XCTAssertEqual(submitted.questionsDigest, String(repeating: "d", count: 64))
        XCTAssertEqual(submitted.answers.map(\.id), batch.questions.map(\.id))
        XCTAssertTrue(submitted.answers.allSatisfy { $0.selectedIndex == 4 })
        XCTAssertFalse(submitted.acceptPartial)
    }

    func testLostAdmissionResponseRetriesTheSameUUIDInsteadOfStartingNewWork() async throws {
        let fixture = try await client(mode: .lostResponse)
        let requestId = UUID()
        do {
            _ = try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: requestId, pollInterval: .zero)
            XCTFail("Expected a lost acknowledgement")
        } catch {}
        let batch = try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: requestId, pollInterval: .zero)
        XCTAssertEqual(batch.placementSessionId.uuidString.lowercased(), PlacementTransportServer.sessionId)
        let admissions = await PlacementTransportServer.shared.requests(host: fixture.host).filter { $0.url?.path == "/api/v1/placement/generate" }
        XCTAssertEqual(admissions.count, 2)
        for request in admissions {
            let admitted = try JSONDecoder().decode(AdmittedPlacement.self, from: try XCTUnwrap(request.httpBody))
            XCTAssertEqual(admitted.requestId, requestId)
        }
    }

    func testSourceDiagnosticCarriesTheObservedAnalysisAndExplicitPartialConsent() async throws {
        let fixture = try await client(mode: .source)
        let source = SottoPlacementAnalysisReference(analysisId: UUID(uuidString: PlacementTransportServer.analysisId)!, analysisRevision: 3, resultDigest: String(repeating: "e", count: 64))
        let batch = try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: UUID(), source: source, acceptPartial: true, pollInterval: .zero)
        _ = try await fixture.client.submitPlacement(batch: batch, requestId: UUID(), answers: batch.questions.map { SottoPlacementAnswer(id: $0.id, selectedIndex: 0) }, acceptPartial: true)
        let requests = await PlacementTransportServer.shared.requests(host: fixture.host)
        let submitted = try JSONDecoder().decode(SubmittedPlacement.self, from: try XCTUnwrap(requests.last?.httpBody))
        XCTAssertEqual(submitted.analysisId, source.analysisId)
        XCTAssertEqual(submitted.analysisRevision, 3)
        XCTAssertEqual(submitted.resultDigest, source.resultDigest)
        XCTAssertTrue(submitted.acceptPartial)
    }

    func testChangedSessionAndRecoveryStatesStopWithoutNewAdmission() async throws {
        for mode in [PlacementTransportServer.Mode.changedIdentity, .recovery] {
            let fixture = try await client(mode: mode)
            do {
                _ = try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: UUID(), pollInterval: .zero)
                XCTFail("Expected a saved-identity or recovery error")
            } catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
            let requests = await PlacementTransportServer.shared.requests(host: fixture.host)
            XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/placement/generate" }.count, 1)
            XCTAssertLessThanOrEqual(requests.count, 2)
        }
    }

    func testCancellationStopsWaitingWithoutAnotherPoll() async throws {
        let fixture = try await client(mode: .neverReady)
        let task = Task { try await fixture.client.fetchPlacement(native: "en", target: "de", requestId: UUID(), pollInterval: .seconds(60)) }
        for _ in 0..<100 {
            if await PlacementTransportServer.shared.requests(host: fixture.host).count == 1 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        task.cancel()
        do { _ = try await task.value; XCTFail("Expected cancellation") } catch {}
        let captured = await PlacementTransportServer.shared.requests(host: fixture.host)
        XCTAssertEqual(captured.count, 1)
    }

    private func client(mode: PlacementTransportServer.Mode) async throws -> (client: SottoAPIClient, host: String) {
        let host = "placement-\(UUID().uuidString.lowercased()).example"
        await PlacementTransportServer.shared.register(host: host, mode: mode)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PlacementTransportHTTP.self]
        return (SottoAPIClient(serverURL: URL(string: "https://\(host)")!, apiKey: "native-fixture", profileId: "learner", session: URLSession(configuration: configuration)), host)
    }
}

private struct AdmittedPlacement: Decodable { let requestId: UUID }

private struct SubmittedPlacement: Decodable {
    struct Answer: Decodable { let id: String; let selectedIndex: Int }
    let requestId: UUID
    let placementSessionId: UUID
    let questionsDigest: String
    let analysisId: UUID?
    let analysisRevision: Int?
    let resultDigest: String?
    let acceptPartial: Bool
    let answers: [Answer]
}

private actor PlacementTransportServer {
    static let shared = PlacementTransportServer()
    static let sessionId = "d1438bc6-a9a6-4c4a-bf12-e7b11c79110a"
    static let analysisId = "d1438bc6-a9a6-4c4a-bf12-e7b11c79110b"
    enum Mode: Sendable, Equatable { case queued, lostResponse, source, changedIdentity, recovery, neverReady }
    private var modes: [String: Mode] = [:]
    private var captured: [String: [URLRequest]] = [:]
    func register(host: String, mode: Mode) { modes[host] = mode; captured[host] = [] }
    func requests(host: String) -> [URLRequest] { captured[host] ?? [] }
    func respond(_ request: URLRequest) throws -> (Int, Data) {
        guard let host = request.url?.host, let mode = modes[host] else { throw URLError(.badURL) }
        var preserved = request
        if preserved.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 4096)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 4096)
                if count <= 0 { break }
                bytes.append(buffer, count: count)
            }
            preserved.httpBody = bytes
        }
        captured[host, default: []].append(preserved)
        let count = captured[host]!.count
        if mode == .lostResponse && count == 1 { throw URLError(.timedOut) }
        if request.httpMethod == "POST" && request.url?.path == "/api/v1/placement" {
            return (200, Data("{\"courseId\":\"course\",\"level\":\"A2\",\"assessedLevel\":\"B1\",\"confirmationReceiptId\":\"\(Self.sessionId)\"}".utf8))
        }
        let status = mode == .recovery ? "RECOVERY_REQUIRED" : mode == .neverReady || count == 1 ? "QUEUED" : count == 2 && mode != .source && mode != .lostResponse && mode != .changedIdentity ? "GENERATING" : "READY"
        var body: [String: Any] = ["native": "en", "target": "de", "placementSessionId": mode == .changedIdentity && count > 1 ? Self.analysisId : Self.sessionId,
            "status": status, "questionsDigest": String(repeating: "d", count: 64), "expiresAt": "2099-01-01T00:00:00.000Z",
            "questions": status == "READY" ? (0..<6).map { ["id": "pq_\($0)", "cefr": "A1", "skill": "grammar", "prompt": "Choose the form \($0).", "options": ["a", "b", "c", "d", "I do not know"]] } : []]
        if mode == .source { body["analysisId"] = Self.analysisId; body["analysisRevision"] = 3; body["resultDigest"] = String(repeating: "e", count: 64) }
        return (status == "READY" || status == "RECOVERY_REQUIRED" ? 200 : 202, try JSONSerialization.data(withJSONObject: body))
    }
}

private final class PlacementTransportHTTP: URLProtocol {
    private var work: Task<Void, Never>?
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasPrefix("placement-") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        work = Task {
            do {
                let (status, body) = try await PlacementTransportServer.shared.respond(request)
                guard !Task.isCancelled else { return }
                let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
                client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: body)
                client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() { work?.cancel() }
}
