import Foundation
import XCTest
@testable import Sotto

final class MaterialSourceTests: XCTestCase {
    func testLegacyCodepointPagesPreserveEveryOriginalUTF8Byte() async throws {
        let fixture = await makeClient()
        let first = try await fixture.client.fetchLegacyMaterialText(materialId: MaterialSourceServer.materialId)
        XCTAssertEqual(first.text.unicodeScalars.count, 8192)
        let second = try await fixture.client.fetchLegacyMaterialText(materialId: MaterialSourceServer.materialId, offset: XCTUnwrap(first.nextOffset))
        XCTAssertNil(second.nextOffset)
        XCTAssertEqual(Data((first.text + second.text).utf8), Data(MaterialSourceServer.legacyText.utf8))
        XCTAssertEqual(first.origin, "LEGACY_EMBEDDED_TEXT")
    }

    func testTextChunkPaginationKeepsTheRunAndOriginAndReturnsOnlyEightChunks() async throws {
        let fixture = await makeClient(mode: .nineChunks)
        let first = try await fixture.client.fetchMaterialPageText(materialId: MaterialSourceServer.materialId, runId: MaterialSourceServer.runId, page: 101, origin: "VISUAL_RECOGNITION")
        XCTAssertEqual(first.chunks.count, 8)
        XCTAssertEqual(first.nextIndex, 7)
        let last = try await fixture.client.fetchMaterialPageText(materialId: MaterialSourceServer.materialId, runId: MaterialSourceServer.runId, page: 101, origin: "VISUAL_RECOGNITION", afterIndex: XCTUnwrap(first.nextIndex))
        XCTAssertEqual(last.chunks.map(\.index), [8])
        XCTAssertNil(last.nextIndex)
        XCTAssertEqual(last.manifest.source.origin, "VISUAL_RECOGNITION")
    }
    func testPagedSourcePreservesBOMNULCombiningMarksAndSupplementaryScalars() async throws {
        let fixture = await makeClient()
        let first = try await fixture.client.fetchMaterialProcessing(materialId: MaterialSourceServer.materialId)
        XCTAssertEqual(first.pages.count, 100)
        XCTAssertEqual(first.nextPage, 100)
        let last = try await fixture.client.fetchMaterialProcessing(materialId: MaterialSourceServer.materialId, afterPage: 100)
        XCTAssertEqual(last.pages.map(\.pageNumber), [101])
        XCTAssertNil(last.nextPage)
        let source = try await fixture.client.fetchMaterialPageText(materialId: MaterialSourceServer.materialId,
            runId: MaterialSourceServer.runId, page: 101, origin: "EMBEDDED_TEXT")
        XCTAssertEqual(source.chunks.first?.text, MaterialSourceServer.text)
        XCTAssertEqual(Data(try XCTUnwrap(source.chunks.first?.text).utf8), Data(MaterialSourceServer.text.utf8))
        XCTAssertEqual(source.chunks.first?.text.unicodeScalars.count, MaterialSourceServer.text.unicodeScalars.count)
        XCTAssertEqual(source.manifest.source.origin, "EMBEDDED_TEXT")
    }

    func testChangedSourceHashAndRunAreRejected() async throws {
        for mode in [MaterialSourceServer.Mode.wrongHash, .wrongRun] {
            let fixture = await makeClient(mode: mode)
            do {
                _ = try await fixture.client.fetchMaterialPageText(materialId: MaterialSourceServer.materialId,
                    runId: MaterialSourceServer.runId, page: 101, origin: "VISUAL_RECOGNITION")
                XCTFail("Expected exact source receipt rejection")
            } catch { XCTAssertFalse(error.localizedDescription.isEmpty) }
        }
    }

    private func makeClient(mode: MaterialSourceServer.Mode = .normal) async -> (client: SottoAPIClient, host: String) {
        let host = "source-\(UUID().uuidString.lowercased()).example"
        await MaterialSourceServer.shared.register(host, mode: mode)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MaterialSourceHTTP.self]
        return (SottoAPIClient(serverURL: URL(string: "https://\(host)")!, apiKey: "source-key", profileId: "learner", session: URLSession(configuration: config)), host)
    }
}

private actor MaterialSourceServer {
    enum Mode: Sendable { case normal, wrongHash, wrongRun, nineChunks }
    static let shared = MaterialSourceServer()
    static let materialId = "00000000-0000-4000-8000-000000000001"
    static let runId = "00000000-0000-4000-8000-000000000002"
    static let text = "\u{FEFF}A\u{0000}e\u{0301}🦎"
    static let legacyText = String(repeating: "x", count: 8190) + "\u{FEFF}A\u{0000}e\u{0301}🦎"
    private var modes: [String: Mode] = [:]
    func register(_ host: String, mode: Mode) { modes[host] = mode }
    func respond(_ request: URLRequest) throws -> Data {
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer source-key",
              request.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "learner" else { throw URLError(.userAuthenticationRequired) }
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        let origin = query.first { $0.name == "origin" }?.value ?? "EMBEDDED_TEXT"
        if request.url!.path.hasSuffix("/legacy-text") {
            let offset = Int(query.first { $0.name == "offset" }!.value!)!
            let limit = Int(query.first { $0.name == "limit" }!.value!)!
            let scalars: [Unicode.Scalar] = Array(Self.legacyText.unicodeScalars)
            let total: Int = scalars.count
            let end = min(total, offset + limit)
            let text = String(String.UnicodeScalarView(scalars[offset..<end]))
            let payload: [String: Any] = ["materialId": Self.materialId, "origin": "LEGACY_EMBEDDED_TEXT", "offset": offset,
                "totalCodePoints": total, "text": text, "nextOffset": end < total ? end as Any : NSNull()]
            return try JSONSerialization.data(withJSONObject: payload)
        }
        let data = Data(Self.text.utf8); let hash = NativeMaterialTransfers.hash(data)
        let manifest: [String: Any] = ["pageNumber": 101, "source": ["origin": origin, "method": "fixture", "version": "1"],
            "textSha256": hash, "codePointLength": Self.text.unicodeScalars.count, "utf8ByteLength": data.count, "chunkCount": 1]
        if request.url!.path.hasSuffix("/processing") {
            let after = Int(query.first { $0.name == "afterPage" }!.value!)!
            return try JSONSerialization.data(withJSONObject: ["materialId": Self.materialId, "processingRevision": 2,
                "originalSha256": hash, "status": "PARTIAL", "diagnostic": "Visual gaps remain.", "run": ["id": Self.runId, "status": "PARTIAL", "pageCount": 101],
                "pages": ((after + 1)...min(101, after + 100)).map { ["pageNumber": $0, "embeddedText": ["state": "EXTRACTED"], "visual": ["state": "UNAVAILABLE"], "textStreams": []] },
                "nextPage": after == 0 ? 100 : NSNull()])
        }
        if modes[request.url!.host!] == .nineChunks {
            let after = Int(query.first { $0.name == "afterIndex" }!.value!)!
            let indices = Array((after + 1)..<min(9, after + 9))
            let manifest: [String: Any] = ["pageNumber": 101, "source": ["origin": origin, "method": "fixture", "version": "1"],
                "textSha256": NativeMaterialTransfers.hash(Data(String(repeating: Self.text, count: 9).utf8)), "codePointLength": Self.text.unicodeScalars.count * 9, "utf8ByteLength": data.count * 9, "chunkCount": 9]
            return try JSONSerialization.data(withJSONObject: ["runId": Self.runId, "manifest": manifest,
                "chunks": indices.map { index in ["index": index, "codePointStart": index * Self.text.unicodeScalars.count, "codePointEnd": (index + 1) * Self.text.unicodeScalars.count,
                    "utf8ByteStart": index * data.count, "utf8ByteEnd": (index + 1) * data.count, "sha256": hash, "text": Self.text] }, "nextIndex": indices.last! < 8 ? indices.last! : NSNull()])
        }
        return try JSONSerialization.data(withJSONObject: ["runId": modes[request.url!.host!] == .wrongRun ? Self.materialId : Self.runId,
            "manifest": manifest, "chunks": [["index": 0, "codePointStart": 0, "codePointEnd": Self.text.unicodeScalars.count,
                "utf8ByteStart": 0, "utf8ByteEnd": data.count, "sha256": modes[request.url!.host!] == .wrongHash ? String(repeating: "0", count: 64) : hash, "text": Self.text]], "nextIndex": NSNull()])
    }
}

private final class MaterialSourceHTTP: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task {
            do {
                let data = try await MaterialSourceServer.shared.respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}
