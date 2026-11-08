import XCTest
@testable import Sotto

@MainActor
final class ClassPreludeTests: XCTestCase {
    private func prelude(_ status: String, recoverable: Bool = false) throws -> SottoClassPrelude {
        let recovery = recoverable ? #", "recoverable": true"# : ""
        let json = #"{"kind":"ADDENDUM","nativeLang":"es","targetLang":"ru","status":"\#(status)","request":{"sourceHash":"\#(ClassPreludeProtocol.source)","snapshotHash":"\#(ClassPreludeProtocol.snapshot)"}\#(recovery)}"#
        return try JSONDecoder().decode(SottoClassPrelude.self, from: Data(json.utf8))
    }

    func testTransportUsesScopedRecoveryAndExactAcknowledgment() async throws {
        let client = ClassPreludeProtocol.makeClient()
        let available = try await client.fetchClassPrelude(classId: "class-1")
        XCTAssertEqual(available.kind, .addendum)
        XCTAssertEqual(available.status, .available)
        let request = try XCTUnwrap(available.request)
        let pending = try await client.prepareClassPrelude(classId: "class-1", request: request, recovery: true)
        XCTAssertEqual(pending.status, .pending)
        try await client.acknowledgeClassPrelude(classId: "class-1", request:
            SottoClassPreludeAcknowledgment(kind: "ADDENDUM", receiptId: ClassPreludeProtocol.receipt))
    }

    func testRejectsMalformedReadyAndMismatchedAcknowledgment() throws {
        let incomplete = #"{"kind":"ADDENDUM","nativeLang":"es","targetLang":"ru","status":"READY","request":{"sourceHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","snapshotHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}"#
        let value = try JSONDecoder().decode(SottoClassPrelude.self, from: Data(incomplete.utf8))
        XCTAssertThrowsError(try value.validate())
        let response = SottoClassPreludeAcknowledgmentResponse(kind: "BASE", receiptId: ClassPreludeProtocol.receipt, acknowledged: true)
        XCTAssertThrowsError(try response.validate(for: SottoClassPreludeAcknowledgment(kind: "ADDENDUM", receiptId: ClassPreludeProtocol.receipt)))
        let blankTeaching = #"{"kind":"BASE","nativeLang":"es","targetLang":"ru","receiptId":"\#(ClassPreludeProtocol.receipt)","acknowledged":false,"teaching":{"version":1,"title":" ","explanation":"Usa cortesía.","workedExamples":[{"prompt":"Agua","answer":"Вода","explanation":"Una bebida."},{"prompt":"Té","answer":"Чай","explanation":"Otra bebida."}],"commonMistake":{"incorrect":"A","correction":"B","explanation":"Una corrección."}}}"#
        let blank = try JSONDecoder().decode(SottoClassPrelude.self, from: Data(blankTeaching.utf8))
        XCTAssertThrowsError(try blank.validate())
        let validTitle = blankTeaching.replacingOccurrences(of: #""title":" ""#, with: #""title":"Pedir""#)
        for invalid in [
            validTitle.replacingOccurrences(of: #""prompt":"Agua""#, with: #""prompt":" ""#),
            validTitle.replacingOccurrences(of: #""incorrect":"A""#, with: #""incorrect":"\#(String(repeating: "A", count: 801))""#),
        ] {
            let malformed = try JSONDecoder().decode(SottoClassPrelude.self, from: Data(invalid.utf8))
            XCTAssertThrowsError(try malformed.validate())
        }
    }

    func testReadingAvailableTeachingDoesNotPrepareIt() async throws {
        let value = try prelude("AVAILABLE")
        let loader = ClassPreludeLoader(read: { value }, prepare: { _, _ in
            XCTFail("Reading a status must not start paid work")
            return value
        }, acknowledge: { _ in XCTFail("Reading must not acknowledge") }, isCurrent: { true })
        let result = try await loader.load { _ in }
        XCTAssertEqual(result.status, .available)
    }

    func testPendingRecoveryCannotAdmitNewPaidWork() async throws {
        let pending = try prelude("PENDING", recoverable: true)
        let available = try prelude("AVAILABLE")
        let loader = ClassPreludeLoader(read: { pending }, prepare: { request, recovery in
            XCTAssertTrue(recovery)
            XCTAssertEqual(request, pending.request)
            return available
        }, acknowledge: { _ in XCTFail("Recovery must not acknowledge") }, isCurrent: { true }, pause: {})
        let result = try await loader.load { _ in }
        XCTAssertEqual(result.status, .available)
    }

    func testChangedScopeCannotStartPreparation() async throws {
        let value = try prelude("AVAILABLE")
        let loader = ClassPreludeLoader(read: { value }, prepare: { _, _ in
            XCTFail("Changed scope must not start paid work")
            return value
        }, acknowledge: { _ in }, isCurrent: { false })
        do {
            _ = try await loader.start(displayed: value) { _ in }
            XCTFail("Changed scope must cancel")
        } catch is CancellationError { }
    }

    func testChangedScopeCannotReadPrelude() async throws {
        let value = try prelude("AVAILABLE")
        let loader = ClassPreludeLoader(read: {
            XCTFail("Changed scope must not issue a read")
            return value
        }, prepare: { _, _ in value }, acknowledge: { _ in }, isCurrent: { false })
        do {
            _ = try await loader.load { _ in }
            XCTFail("Changed scope must cancel")
        } catch is CancellationError { }
    }

    func testAcknowledgmentRequiresTheSameReceiptAfterReread() async throws {
        let json = #"{"kind":"BASE","nativeLang":"es","targetLang":"ru","receiptId":"\#(ClassPreludeProtocol.receipt)","acknowledged":false,"teaching":{"version":1,"title":"Pedir","explanation":"Usa cortesía.","workedExamples":[{"prompt":"Agua","answer":"Вода","explanation":"Una bebida."},{"prompt":"Té","answer":"Чай","explanation":"Otra bebida."}],"commonMistake":{"incorrect":"A","correction":"B","explanation":"Una corrección."}}}"#
        let displayed = try JSONDecoder().decode(SottoClassPrelude.self, from: Data(json.utf8))
        let replaced = json.replacingOccurrences(of: ClassPreludeProtocol.receipt,
            with: "00000000-0000-4000-a000-000000000002").replacingOccurrences(of: "false", with: "true")
        let current = try JSONDecoder().decode(SottoClassPrelude.self, from: Data(replaced.utf8))
        let loader = ClassPreludeLoader(read: { current }, prepare: { _, _ in
            XCTFail("Acknowledgment must not prepare")
            return current
        }, acknowledge: { request in
            XCTAssertEqual(request, SottoClassPreludeAcknowledgment(kind: "BASE", receiptId: ClassPreludeProtocol.receipt))
        }, isCurrent: { true })
        do {
            _ = try await loader.acknowledge(displayed: displayed)
            XCTFail("A replacement receipt must not unlock the lesson")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("lesson changed"))
        }
    }
}

private final class ClassPreludeProtocol: URLProtocol {
    static let receipt = "00000000-0000-4000-a000-000000000001"
    static let source = String(repeating: "a", count: 64)
    static let snapshot = String(repeating: "b", count: 64)

    static func makeClient() -> SottoAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ClassPreludeProtocol.self]
        return SottoAPIClient(serverURL: URL(string: "https://school.example")!, apiKey: "help-key", profileId: "learner", session: URLSession(configuration: configuration))
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer help-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Sotto-Profile-Id"), "learner")
        XCTAssertFalse(request.httpShouldHandleCookies)
        let path = request.url?.path ?? ""
        let isPrepare = path.hasSuffix("/prepare")
        let isAcknowledgment = path.hasSuffix("/acknowledge")
        if isPrepare { XCTAssertEqual(request.url?.query, "recover=1") }
        if request.httpMethod == "POST" {
            do {
                let captured = try request.capturingNativeTestBody()
                let data = try XCTUnwrap(captured.httpBody)
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
                XCTAssertEqual(body, isAcknowledgment
                    ? ["kind": "ADDENDUM", "receiptId": Self.receipt]
                    : ["sourceHash": Self.source, "snapshotHash": Self.snapshot])
            } catch {
                XCTFail("Could not inspect the prelude request: \(error)")
                client?.urlProtocol(self, didFailWithError: error)
                return
            }
        } else {
            XCTAssertEqual(path, "/api/v1/classes/class-1/teaching-prelude")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
        }
        let body: String
        if isAcknowledgment {
            body = #"{"kind":"ADDENDUM","receiptId":"\#(Self.receipt)","acknowledged":true}"#
        } else {
            let status = isPrepare ? "PENDING" : "AVAILABLE"
            body = #"{"kind":"ADDENDUM","nativeLang":"es","targetLang":"ru","status":"\#(status)","request":{"sourceHash":"\#(Self.source)","snapshotHash":"\#(Self.snapshot)"}}"#
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: isPrepare ? 202 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
