import Foundation
import XCTest
@testable import Sotto

final class LearningMapTransportTests: XCTestCase {
    func testSourceAndCheckedObjectivesRemainCombinedThroughPreviewAndAdmission() async throws {
        let fixture = await makeClient()
        let map = try await fixture.client.fetchLearningMap(courseId: "course", level: .a1)
        let source = SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: .a1,
            materialFocusId: String(repeating: "f", count: 64))
        let combined = try map.practiceSelection(source: source, selected: ["de.a1.order"])
        XCTAssertEqual(combined.catalogVersion, 1)
        XCTAssertEqual(combined.nodeIds, ["de.a1.order"])
        let preview = try await fixture.client.previewLearningSelection(courseId: "course", selection: combined)
        XCTAssertEqual(preview.sourceCreditMessage,
            "Your source guides this practice. Eligible assessment results can contribute to the selected objectives.")
        _ = try await fixture.client.startPractice(courseId: "course", kind: "GRAMMAR", requestId: UUID(),
            learningSelection: preview.explicitSelection())
        let requests = await LearningMapServer.shared.requests(fixture.host)
        let body = try JSONDecoder().decode(PracticeRequest.self, from: XCTUnwrap(requests.last?.httpBody))
        XCTAssertEqual(body.learningSelection, combined)
        let privateSelection = try map.practiceSelection(source: source, selected: [])
        XCTAssertNil(privateSelection.catalogVersion)
        XCTAssertTrue(privateSelection.nodeIds.isEmpty)
        let privatePreview = try await fixture.client.previewLearningSelection(courseId: "course", selection: privateSelection)
        XCTAssertEqual(privatePreview.sourceCreditMessage, "Private source practice. No canonical objective credit.")
    }

    func testCombinedSelectionRejectsChangedBandAndUnknownOrGroupedObjectives() async throws {
        let fixture = await makeClient()
        let map = try await fixture.client.fetchLearningMap(courseId: "course", level: .a1)
        for id in ["de.grammar", "unknown.objective"] {
            XCTAssertThrowsError(try map.practiceSelection(source: nil, selected: [id]))
        }
        let changed = SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: .a2,
            materialFocusId: String(repeating: "f", count: 64))
        XCTAssertThrowsError(try map.practiceSelection(source: changed, selected: ["de.a1.order"]))
        let future = try await fixture.client.fetchLearningMap(courseId: "course", level: .b1)
        XCTAssertThrowsError(try future.practiceSelection(source: nil, selected: ["de.a1.order"]))
    }

    func testSourceOnlyPreviewKeepsTheExactFocusWithoutManufacturingCanonicalObjectives() async throws {
        let fixture = await makeClient()
        let selected = SottoLearningSelection(catalogVersion: nil, nodeIds: [], level: .a1, materialFocusId: String(repeating: "f", count: 64))
        let preview = try await fixture.client.previewLearningSelection(courseId: "course", selection: selected)
        XCTAssertTrue(preview.selection.objectives.isEmpty)
        XCTAssertEqual(preview.explicitSelection().nodeIds, [])
        XCTAssertEqual(preview.explicitSelection().materialFocusId, selected.materialFocusId)
        XCTAssertEqual(preview.explicitSelection().level, .a1)
        let requests = await LearningMapServer.shared.requests(fixture.host)
        let body = try XCTUnwrap(requests.last?.httpBody)
        let wire = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertTrue(wire["catalogVersion"] is NSNull)
        XCTAssertEqual(wire["nodeIds"] as? [String], [])
    }
    func testLowerLevelSelectionRemainsExactThroughPreviewAndPracticeAdmission() async throws {
        let fixture = await makeClient()
        let map = try await fixture.client.fetchLearningMap(courseId: "course", level: .a1)
        XCTAssertEqual(map.currentLevel, .a2)
        XCTAssertFalse(map.previewOnly)
        XCTAssertFalse(map.canAdvance)
        let selected = SottoLearningSelection(catalogVersion: 1, nodeIds: ["de.grammar"], level: .a1)
        let preview = try await fixture.client.previewLearningSelection(courseId: "course", selection: selected)
        XCTAssertEqual(preview.explicitSelection().nodeIds, ["de.a1.order"])
        let requestId = UUID()
        _ = try await fixture.client.startPractice(courseId: "course", kind: "GRAMMAR", requestId: requestId,
            learningSelection: preview.explicitSelection())
        let requests = await LearningMapServer.shared.requests(fixture.host)
        let last = try XCTUnwrap(requests.last)
        let body = try JSONDecoder().decode(PracticeRequest.self, from: try XCTUnwrap(last.httpBody))
        XCTAssertEqual(body.requestId, requestId)
        XCTAssertEqual(body.learningSelection.level, .a1)
        XCTAssertEqual(body.learningSelection.nodeIds, ["de.a1.order"])
        XCTAssertFalse(requests.contains { $0.url?.path.hasSuffix("/advance") == true })
    }

    func testFutureBandIsPreviewOnlyAndDueRemainsSeparateFromConfidence() async throws {
        let fixture = await makeClient()
        let preview = try await fixture.client.fetchLearningMap(courseId: "course", level: .b1)
        XCTAssertTrue(preview.previewOnly)
        XCTAssertFalse(preview.canAdvance)
        let leaf = try XCTUnwrap(preview.nodes.first { $0.node.kind == "OBJECTIVE" })
        XCTAssertEqual(leaf.node.title, "Put the finite verb in second position")
        XCTAssertEqual(leaf.node.examples, ["Heute fahre ich nach Berlin."])
        XCTAssertEqual(leaf.progress?.status, "CONFIDENT")
        XCTAssertTrue(leaf.progress?.reviewDue == true)
        XCTAssertEqual(leaf.node.skillCriteria?["GRAMMAR"], "Use the finite verb in second position without a supplied answer.")
        XCTAssertEqual(preview.visibleNodeIds(query: "Heute"), ["de.grammar", "de.a1.order"])
        XCTAssertTrue(preview.visibleNodeIds(query: "No matching phrase").isEmpty)
    }

    func testLostAdvanceAcknowledgementReplaysTheSameExpectedBandAndUUID() async throws {
        let fixture = await makeClient(loseAdvance: true)
        let request = SottoLearningAdvanceRequest(requestId: UUID(), expectedLevel: .a2, catalogHash: String(repeating: "a", count: 64))
        do { _ = try await fixture.client.advanceLearningLevel(courseId: "course", request: request); XCTFail("Expected lost acknowledgement") } catch {}
        let receipt = try await fixture.client.advanceLearningLevel(courseId: "course", request: request)
        XCTAssertEqual(receipt.currentLevel, .b1)
        let requests = await LearningMapServer.shared.requests(fixture.host)
        let advances = try requests.filter { $0.url?.path.hasSuffix("/advance") == true }.map {
            try JSONDecoder().decode(SottoLearningAdvanceRequest.self, from: XCTUnwrap($0.httpBody))
        }
        XCTAssertEqual(advances, [request, request])
    }

    func testForeignReceiptAndCyclicTreeAreRejectedBeforeRendering() async throws {
        for mode in [LearningMapServer.Mode.foreign, .cycle] {
            let fixture = await makeClient(mode: mode)
            do { _ = try await fixture.client.fetchLearningMap(courseId: "course", level: .a1); XCTFail("Expected invalid receipt rejection") }
            catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        }
    }

    private func makeClient(mode: LearningMapServer.Mode = .normal, loseAdvance: Bool = false) async -> (client: SottoAPIClient, host: String) {
        let host = "map-\(UUID().uuidString.lowercased()).example"
        await LearningMapServer.shared.register(host, mode: mode, loseAdvance: loseAdvance)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [LearningMapHTTP.self]
        return (SottoAPIClient(serverURL: URL(string: "https://\(host)")!, apiKey: "synthetic-key", profileId: "learner", session: URLSession(configuration: config)), host)
    }
}

private struct PracticeRequest: Decodable { let requestId: UUID; let learningSelection: SottoLearningSelection }

private actor LearningMapServer {
    enum Mode: Sendable { case normal, foreign, cycle }
    static let shared = LearningMapServer()
    private var modes: [String: Mode] = [:]
    private var lost = Set<String>()
    private var captured: [String: [URLRequest]] = [:]
    func register(_ host: String, mode: Mode, loseAdvance: Bool) { modes[host] = mode; captured[host] = []; if loseAdvance { lost.insert(host) } }
    func requests(_ host: String) -> [URLRequest] { captured[host] ?? [] }
    func respond(_ input: URLRequest) throws -> Data {
        let request = try input.capturingNativeTestBody()
        let host = request.url!.host!
        captured[host, default: []].append(request)
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-key",
              request.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "learner" else { throw URLError(.userAuthenticationRequired) }
        if request.url!.path.hasSuffix("/advance") {
            if lost.remove(host) != nil { throw URLError(.timedOut) }
            return try JSONSerialization.data(withJSONObject: ["completed": true, "courseId": "course", "level": "A2", "currentLevel": "B1", "nextLevel": "B1", "requirementId": "binding", "completedAt": "2026-10-20T10:00:00Z", "exemptSkills": []])
        }
        if request.url!.path.hasSuffix("/practice") {
            let body = try JSONDecoder().decode(PracticeRequest.self, from: request.httpBody!)
            return try JSONSerialization.data(withJSONObject: ["status": "preparing", "sessionId": body.requestId.uuidString, "kind": "GRAMMAR", "preparationStatus": "QUEUED"])
        }
        if request.url!.path.hasSuffix("/selection") {
            let selection = try JSONDecoder().decode(SottoLearningSelection.self, from: request.httpBody!)
            let sourceOnly = selection.nodeIds.isEmpty
            return try JSONSerialization.data(withJSONObject: ["selection": ["catalogVersion": 1, "targetLang": "de", "level": "A1", "nodeIds": selection.nodeIds, "materialFocusId": selection.materialFocusId as Any? ?? NSNull(), "objectives": sourceOnly ? [] : [["id": "de.a1.order", "title": "Put the finite verb in second position", "level": "A1"]]], "availableKinds": ["FULL", "GRAMMAR"], "requirementId": "binding"])
        }
        let level = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems?.first(where: { $0.name == "level" })?.value ?? "A2"
        let parent = modes[host] == .cycle ? "de.grammar" : NSNull() as Any
        let group: [String: Any] = ["id": "de.grammar", "parentId": parent, "branch": "GRAMMAR", "kind": "GROUP", "title": "Grammar", "description": "Sentence patterns", "order": 0]
        let leaf: [String: Any] = ["id": "de.a1.order", "parentId": "de.grammar", "branch": "GRAMMAR", "kind": "OBJECTIVE", "title": "Put the finite verb in second position", "description": "Word order", "order": 1, "level": level, "skills": ["GRAMMAR"], "skillCriteria": ["GRAMMAR": "Use the finite verb in second position without a supplied answer."], "assessment": "Build an independent statement.", "examples": ["Heute fahre ich nach Berlin."]]
        let summary: [String: Any] = ["total": 1, "confident": 1, "notAssessed": 0, "reviewDue": 1]
        return try JSONSerialization.data(withJSONObject: ["courseId": modes[host] == .foreign ? "foreign" : "course", "targetLang": "de", "currentLevel": "A2", "viewedLevel": level, "catalogVersion": 1, "catalogHash": String(repeating: "a", count: 64), "requirementId": "binding", "coverage": NSNull(), "readiness": ["level": level, "nextLevel": "B1", "ready": true, "requiredCount": 1, "confidentCount": 1, "unassessedCount": 0, "practisingCount": 0, "needsWorkCount": 0, "missingObjectiveIds": [], "exemptSkills": []], "blockers": [], "completedAt": NSNull(), "references": [["title": "CEFR", "url": "https://www.coe.int/"]], "nodes": [["node": group, "progress": NSNull(), "summary": summary], ["node": leaf, "summary": summary, "progress": ["objectiveId": "de.a1.order", "status": "CONFIDENT", "reviewDue": true, "skills": [["skill": "GRAMMAR", "status": "CONFIDENT", "exempt": false]]]]]])
    }
}

private final class LearningMapHTTP: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task {
            do {
                let data = try await LearningMapServer.shared.respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}
