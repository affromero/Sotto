import Foundation
import CryptoKit
import XCTest
@testable import Sotto

final class ResumableUploadTests: XCTestCase {
    func testFilenameRequiringServerSanitizationIsRejectedBeforeAdmission() async throws {
        let fixture = try await makeFixture(mode: .paginatedNotes)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let unsafe = fixture.directory.appendingPathComponent("notes\noriginal.pdf")
        try FileManager.default.moveItem(at: fixture.file, to: unsafe)
        do {
            _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [unsafe], storeRoot: fixture.directory.appendingPathComponent("receipts"))
            XCTFail("Expected filename validation before admission")
        } catch { XCTAssertTrue(error.localizedDescription.contains("Rename this original")) }
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertTrue(requests.isEmpty)
    }
    func testOriginalAttachmentIsConfirmedBeyondTheFirstMaterialMetadataPage() async throws {
        let fixture = try await makeFixture(mode: .paginatedNotes)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("receipts")
        let first = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: root, pollInterval: .zero)
        XCTAssertEqual(first.materials?.count, 20)
        XCTAssertEqual(first.nextCursor, "next-materials")
        let next = try await fixture.client.fetchCourseNotes(courseId: "course", cursor: first.nextCursor)
        XCTAssertEqual(next.materials?.first?.name, "large.pdf")
        XCTAssertNil(next.nextCursor)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertTrue(requests.contains { $0.url?.query == "after=next%2Dmaterials" || $0.url?.query == "after=next-materials" })
    }
    func testExplicitResumeRenewsItsWaitingBudgetAndKeepsTheCommittedPartAndRequestIdentity() async throws {
        let fixture = try await makeFixture(mode: .lostPart)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("receipts")
        do { _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: root, pollInterval: .zero); XCTFail("Expected interrupted part acknowledgement") } catch {}
        let folder = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first)
        let checkpoint = folder.appendingPathComponent("receipt.json")
        var saved = try JSONDecoder().decode(SottoMaterialTransferCheckpoint.self, from: Data(contentsOf: checkpoint))
        let requestId = saved.request.requestId
        saved.deadline = .distantPast
        try JSONEncoder().encode(saved).write(to: checkpoint, options: .atomic)
        let result = try await fixture.client.importResumableMaterials(courseId: "course", urls: [], storeRoot: root, pollInterval: .zero)
        XCTAssertEqual(result.materials?.first?.name, "large.pdf")
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/materials/uploads" }.count, 1)
        let declaration = try JSONDecoder().decode(SottoMaterialBatchRequest.self, from: XCTUnwrap(requests.first { $0.url?.path == "/api/v1/materials/uploads" }?.httpBody))
        XCTAssertEqual(declaration.requestId, requestId)
        XCTAssertEqual(requests.filter { $0.httpMethod == "PUT" }.map { $0.url!.lastPathComponent }, ["0", "1", "2"])
    }
    func testStoppingAndUnconfirmedCancellationRetainTheSameFinalizingReceipt() async throws {
        let fixture = try await makeFixture(mode: .unconfirmedCancel)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("receipts")
        let task = Task { try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: root, pollInterval: .seconds(60)) }
        for _ in 0..<200 {
            let requests = await MaterialUploadServer.shared.requests(fixture.host)
            if requests.contains(where: { $0.url?.path.hasSuffix("/complete") == true }) { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        task.cancel()
        do { _ = try await task.value; XCTFail("Expected cancellation") } catch { XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled) }
        do { try await fixture.client.cancelMaterialTransfer(courseId: "course", storeRoot: root); XCTFail("Expected cleanup uncertainty") }
        catch { XCTAssertTrue(error.localizedDescription.contains("cleanup is not confirmed")) }
        let folders = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        XCTAssertEqual(folders.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: folders[0].appendingPathComponent("receipt.json").path))
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/materials/uploads" }.count, 1)
        XCTAssertEqual(requests.filter { $0.httpMethod == "DELETE" }.count, 1)
    }
    func testLargeOriginalUsesFileBackedPartsAndResumesTheSameAdmissionAfterLostResponse() async throws {
        let fixture = try await makeFixture(mode: .lostAdmission)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        do {
            _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero)
            XCTFail("Expected the lost admission acknowledgement")
        } catch { XCTAssertEqual((error as? URLError)?.code, .timedOut) }
        let before = await MaterialUploadServer.shared.requests(fixture.host)
        let admitted = try JSONDecoder().decode(SottoMaterialBatchRequest.self, from: XCTUnwrap(before.first(where: { $0.url?.path == "/api/v1/materials/uploads" })?.httpBody))
        XCTAssertEqual(admitted.files.first?.byteSize, 11 * 1_048_576 + 19)
        // A new client instance reopens file-backed originals without File picker objects.
        let reopened = SottoAPIClient(serverURL: fixture.client.serverURL, apiKey: "native-key", profileId: "learner", session: fixture.session)
        let response = try await reopened.importResumableMaterials(courseId: "course", urls: [], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero)
        XCTAssertEqual(response.materials?.first?.name, "large.pdf")
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        let admissions = try requests.filter { $0.url?.path == "/api/v1/materials/uploads" }.map {
            try JSONDecoder().decode(SottoMaterialBatchRequest.self, from: XCTUnwrap($0.httpBody))
        }
        XCTAssertEqual(admissions.map(\.requestId), [admitted.requestId, admitted.requestId])
        let parts = requests.filter { $0.httpMethod == "PUT" }
        XCTAssertEqual(parts.map { $0.httpBody?.count ?? 0 }, [4_194_304, 4_194_304, 3_145_747])
        var digest = SHA256()
        for part in parts { digest.update(data: try XCTUnwrap(part.httpBody)) }
        XCTAssertEqual(digest.finalize().map { String(format: "%02x", $0) }.joined(), admitted.files[0].sha256)
        XCTAssertTrue(parts.allSatisfy { $0.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream" })
        XCTAssertTrue(requests.allSatisfy { $0.value(forHTTPHeaderField: "x-sotto-expected-profile-id") == "learner" || $0.url?.path.hasSuffix("/notes") == true })
        XCTAssertFalse(requests.contains { $0.httpMethod == "POST" && $0.url?.path.hasSuffix("/notes") == true })
        let retained = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.appendingPathComponent("receipts").path)
        XCTAssertTrue(retained.isEmpty)
    }

    func testForeignOriginalReceiptRetainsCheckpointAndNeverCompletesIt() async throws {
        let fixture = try await makeFixture(mode: .wrongIdentity)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        do {
            _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero)
            XCTFail("Expected changed receipt rejection")
        } catch { XCTAssertTrue(error.localizedDescription.contains("identity")) }
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertFalse(requests.contains { $0.url?.path.hasSuffix("/complete") == true })
        let receipts = try FileManager.default.contentsOfDirectory(at: fixture.directory.appendingPathComponent("receipts"), includingPropertiesForKeys: nil)
        XCTAssertEqual(receipts.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: receipts[0].appendingPathComponent("receipt.json").path))
    }

    func testAProfileSwitchCannotReuseAnotherLearnersLocalReceipt() async throws {
        let fixture = try await makeFixture(mode: .lostAdmission)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        do { _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero) } catch {}
        let other = SottoAPIClient(serverURL: fixture.client.serverURL, apiKey: "native-key", profileId: "foreign", session: fixture.session)
        do {
            _ = try await other.importResumableMaterials(courseId: "course", urls: [], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero)
            XCTFail("Expected scoped receipt isolation")
        } catch { XCTAssertTrue(error.localizedDescription.contains("no saved upload")) }
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertFalse(requests.contains { $0.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "foreign" })
    }

    func testAnUncertainCompletionReopensItsOriginalWithoutAdmittingANewBatch() async throws {
        let fixture = try await makeFixture(mode: .lostCompletion)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        do { _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [fixture.file], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero); XCTFail("Expected lost completion response") } catch {}
        _ = try await fixture.client.importResumableMaterials(courseId: "course", urls: [], storeRoot: fixture.directory.appendingPathComponent("receipts"), pollInterval: .zero)
        let requests = await MaterialUploadServer.shared.requests(fixture.host)
        XCTAssertEqual(requests.filter { $0.url?.path == "/api/v1/materials/uploads" }.count, 1)
        XCTAssertEqual(requests.filter { $0.url?.path.hasSuffix("/complete") == true }.count, 1)
    }

    private func makeFixture(mode: MaterialUploadServer.Mode) async throws -> (client: SottoAPIClient, session: URLSession, host: String, directory: URL, file: URL) {
        let host = "upload-\(UUID().uuidString.lowercased()).example"
        await MaterialUploadServer.shared.register(host, mode: mode)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [MaterialUploadHTTP.self]
        let session = URLSession(configuration: config)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("large.pdf")
        FileManager.default.createFile(atPath: file.path, contents: nil)
        let handle = try FileHandle(forWritingTo: file)
        for _ in 0..<11 { try handle.write(contentsOf: Data(repeating: 65, count: 1_048_576)) }
        try handle.write(contentsOf: Data(repeating: 66, count: 19)); try handle.close()
        return (SottoAPIClient(serverURL: URL(string: "https://\(host)")!, apiKey: "native-key", profileId: "learner", session: session), session, host, directory, file)
    }
}

private actor MaterialUploadServer {
    enum Mode: Sendable { case lostAdmission, wrongIdentity, lostCompletion, unconfirmedCancel, lostPart, paginatedNotes }
    static let shared = MaterialUploadServer()
    private let batchId = "00000000-0000-4000-8000-000000000001"
    private let uploadId = "00000000-0000-4000-8000-000000000002"
    private let materialId = "00000000-0000-4000-8000-000000000003"
    private var modes: [String: Mode] = [:]
    private var captured: [String: [URLRequest]] = [:]
    private var declarations: [String: SottoMaterialBatchRequest] = [:]
    private var parts: [String: [[String: Any]]] = [:]
    private var completed = Set<String>()
    private var lost = Set<String>()
    func register(_ host: String, mode: Mode) { modes[host] = mode; captured[host] = []; parts[host] = [] }
    func requests(_ host: String) -> [URLRequest] { captured[host] ?? [] }
    func respond(_ input: URLRequest) throws -> Data {
        let request = try input.capturingNativeTestBody(); let host = request.url!.host!; let path = request.url!.path
        captured[host, default: []].append(request)
        guard request.value(forHTTPHeaderField: "Authorization") == "Bearer native-key", request.value(forHTTPHeaderField: "X-Sotto-Profile-Id") == "learner" else { throw URLError(.userAuthenticationRequired) }
        if path == "/api/v1/users/me" { return Data(#"{"id":"learner"}"#.utf8) }
        if path.hasSuffix("/notes") {
            if modes[host] == .paginatedNotes, request.url?.query == nil {
                return try JSONSerialization.data(withJSONObject: ["body": "My editable notes", "nextCursor": "next-materials", "materials": (0..<20).map { ["id": "earlier-\($0)", "name": "Earlier original \($0).pdf", "mimeType": "application/pdf", "byteSize": 12] }])
            }
            return try JSONSerialization.data(withJSONObject: ["body": "My editable notes", "materials": [["id": materialId, "name": "large.pdf", "mimeType": "application/pdf", "byteSize": declarations[host]!.files[0].byteSize]]])
        }
        if path == "/api/v1/materials/uploads" {
            let declaration = try JSONDecoder().decode(SottoMaterialBatchRequest.self, from: request.httpBody!)
            if let existing = declarations[host] { guard declaration.requestId == existing.requestId else { throw URLError(.badServerResponse) } }
            declarations[host] = declaration
            if modes[host] == .lostAdmission, lost.insert(host).inserted { throw URLError(.timedOut) }
            return try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "batchId": batchId, "requestId": declaration.requestId, "uploads": [receipt(host)]])
        }
        if request.httpMethod == "PUT" {
            let bytes = request.httpBody ?? Data()
            let index = Int(path.split(separator: "/").last!)!
            guard bytes.count == Int(request.value(forHTTPHeaderField: "x-sotto-upload-bytes")!)!,
                  NativeMaterialTransfers.hash(bytes) == request.value(forHTTPHeaderField: "x-sotto-upload-sha256") else { throw URLError(.badServerResponse) }
            parts[host, default: []].append(["schemaVersion": 1, "uploadId": uploadId, "index": index,
                "offset": Int(request.value(forHTTPHeaderField: "x-sotto-upload-offset")!)!, "byteSize": bytes.count,
                "sha256": NativeMaterialTransfers.hash(bytes), "committedAt": "2026-10-20T12:00:00Z"])
            if modes[host] == .lostPart, lost.insert(host).inserted { throw URLError(.timedOut) }
        }
        if path.hasSuffix("/complete") {
            completed.insert(host)
            if modes[host] == .lostCompletion, lost.insert(host).inserted { throw URLError(.timedOut) }
        }
        var result = receipt(host)
        if modes[host] == .wrongIdentity { result["materialId"] = "00000000-0000-4000-8000-000000000099" }
        return try JSONSerialization.data(withJSONObject: result)
    }
    private func receipt(_ host: String) -> [String: Any] {
        let declaration = declarations[host]!.files[0]
        let file = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(declaration))
        let published = completed.contains(host) && modes[host] != .unconfirmedCancel
        return ["schemaVersion": 1, "batchId": batchId, "uploadId": uploadId, "materialId": materialId,
            "limitsVersion": 1, "file": file, "status": published ? "COMPLETE" : completed.contains(host) ? "FINALIZING" : "UPLOADING",
            "revision": parts[host]!.count, "expiresAt": "2099-01-01T00:00:00Z", "parts": parts[host]!,
            "original": published ? ["schemaVersion": 1, "uploadId": uploadId, "materialId": materialId,
                "byteSize": declaration.byteSize, "sha256": declaration.sha256, "publishedAt": "2026-10-20T12:00:00Z"] : NSNull(),
            "failureReason": NSNull()]
    }
}

private final class MaterialUploadHTTP: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Task {
            do {
                let data = try await MaterialUploadServer.shared.respond(request)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
    }
    override func stopLoading() {}
}
